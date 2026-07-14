import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const WINDOW_MINUTES = Number(getArgValue('--minutes') || process.env.SOPHIA_MONITOR_WINDOW_MINUTES || 60);
const SINCE = Date.now() - WINDOW_MINUTES * 60 * 1000;
const checks = [];

function addCheck(name, status, detail = '') {
  checks.push({ name, status, detail });
}

function icon(status) {
  if (status === 'ok') return '[OK]';
  if (status === 'warn') return '[WARN]';
  return '[FAIL]';
}

async function run(command, args = [], options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options.timeout ?? 10000,
      maxBuffer: options.maxBuffer ?? 5 * 1024 * 1024,
    });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    return {
      ok: false,
      code: error.code,
      stdout: String(error.stdout || '').trim(),
      stderr: String(error.stderr || error.message || '').trim(),
    };
  }
}

async function commandExists(command) {
  const result = await run('sh', ['-lc', `command -v ${command}`], { timeout: 5000 });
  return result.ok;
}

function parseJsonLines(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function isRecent(timestamp) {
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) && time >= SINCE;
}

async function readTail(path, lines = 1000) {
  const direct = await run('tail', ['-n', String(lines), path]);
  if (direct.ok) return direct.stdout;

  if (await commandExists('sudo')) {
    const viaSudo = await run('sudo', ['-n', 'tail', '-n', String(lines), path]);
    if (viaSudo.ok) return viaSudo.stdout;
  }

  throw new Error(direct.stderr || `No se pudo leer ${path}`);
}

async function checkPm2Sophia() {
  if (!(await commandExists('pm2'))) {
    addCheck('PM2 Sophia', 'fail', 'pm2 no disponible');
    return;
  }

  const result = await run('pm2', ['jlist']);
  if (!result.ok || !result.stdout) {
    addCheck('PM2 Sophia', 'fail', result.stderr || 'pm2 jlist no devolvio datos');
    return;
  }

  try {
    const apps = JSON.parse(result.stdout);
    const app = apps.find((candidate) => candidate.name === 'sophia');
    if (!app) {
      addCheck('PM2 Sophia', 'fail', 'App sophia no encontrada en PM2');
      return;
    }

    const status = app.pm2_env?.status || 'unknown';
    const restarts = Number(app.pm2_env?.restart_time || 0);
    const uptimeMs = app.pm2_env?.pm_uptime ? Date.now() - app.pm2_env.pm_uptime : 0;
    const memoryMb = app.monit?.memory ? Math.round(app.monit.memory / 1024 / 1024) : 'n/a';
    const detail = `status=${status} pid=${app.pid || 'n/a'} restarts=${restarts} uptimeMin=${Math.floor(uptimeMs / 60000)} memMB=${memoryMb}`;
    const state = status !== 'online' ? 'fail' : restarts >= 5 ? 'warn' : 'ok';
    addCheck('PM2 Sophia', state, detail);
  } catch (error) {
    addCheck('PM2 Sophia', 'fail', `No se pudo parsear pm2 jlist: ${error.message}`);
  }
}

async function checkBackendHealth() {
  if (!(await commandExists('curl'))) {
    addCheck('Backend health', 'warn', 'curl no disponible');
    return;
  }

  const result = await run('curl', [
    '-sS', '-m', '8', '-o', '/dev/null', '-w', '%{http_code}',
    'http://localhost:3001/api/teams/health'
  ]);
  const code = result.stdout.trim();
  addCheck('Backend health', result.ok && code === '200' ? 'ok' : 'fail', `http://localhost:3001/api/teams/health -> ${code || 'n/a'} ${result.stderr || ''}`.trim());
}

async function checkTeamsAudit() {
  const path = 'teams-audit.log';
  if (!existsSync(path)) {
    addCheck('Teams audit', 'warn', `No encontrado: ${path}`);
    return;
  }

  const raw = await readTail(path, 1500);
  const events = parseJsonLines(raw).filter((event) => isRecent(event.timestamp));
  const received = events.filter((event) => event.outcome === 'message_received');
  const replies = events.filter((event) => event.outcome === 'reply_sent');
  const cards = events.filter((event) => event.format === 'adaptive_card');
  const errors = events.filter((event) => String(event.outcome || '').includes('error'));
  const last = events.at(-1);
  const missingReplies = Math.max(0, received.length - replies.length);
  const status = errors.length || missingReplies > 0 ? 'warn' : 'ok';
  const detail = [
    `window=${WINDOW_MINUTES}m`,
    `messages=${received.length}`,
    `replies=${replies.length}`,
    `cards=${cards.length}`,
    `errors=${errors.length}`,
    `missingReplies=${missingReplies}`,
    last ? `last=${last.timestamp} ${last.outcome}` : 'last=n/a'
  ].join(' ');
  addCheck('Teams audit', status, detail);
}

async function checkToolAudit() {
  const path = 'audit.log';
  if (!existsSync(path)) {
    addCheck('Tool audit', 'warn', `No encontrado: ${path}`);
    return;
  }

  const raw = await readTail(path, 1500);
  const events = parseJsonLines(raw).filter((event) => isRecent(event.timestamp));
  const errors = events.filter((event) => String(event.outcome || '').includes('error') || event.error);
  const denied = events.filter((event) => event.outcome === 'authorization_denied');
  const confirmations = events.filter((event) => event.outcome === 'confirmation_required');
  const successes = events.filter((event) => ['success', 'confirmed_success'].includes(event.outcome));
  const byTool = countBy(events, (event) => event.toolName || 'unknown');
  const topTools = Object.entries(byTool).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([tool, count]) => `${tool}:${count}`).join(', ');
  const errorRate = events.length ? errors.length / events.length : 0;
  const status = errors.length >= 5 && errorRate >= 0.2 ? 'fail' : errors.length || denied.length ? 'warn' : 'ok';
  addCheck('Tool audit', status, `window=${WINDOW_MINUTES}m events=${events.length} success=${successes.length} confirmations=${confirmations.length} errors=${errors.length} errorRate=${Math.round(errorRate * 100)}% denied=${denied.length} tools=${topTools || 'n/a'}`);
}

async function checkSdpDebug() {
  const path = 'sdp-debug.log';
  if (!existsSync(path)) {
    addCheck('SDP debug', 'warn', `No encontrado: ${path}`);
    return;
  }

  const raw = await readTail(path, 800);
  const lines = raw.split('\n').filter(Boolean);
  const recent = lines.filter((line) => {
    const match = line.match(/^\[(.*?)\]/);
    return match ? isRecent(match[1]) : true;
  });
  const createRequests = recent.filter((line) => line.includes('Creando request')).length;
  const listRequests = recent.filter((line) => line.includes('Enviando a /requests')).length;
  const likelyErrors = recent.filter((line) => /error|failed|status_code":40|Invalid Input|mandatory/i.test(line));
  const status = likelyErrors.length >= 3 ? 'fail' : likelyErrors.length ? 'warn' : 'ok';
  addCheck('SDP debug', status, `window=${WINDOW_MINUTES}m lines=${recent.length} list=${listRequests} create=${createRequests} possibleErrors=${likelyErrors.length}`);
}

async function checkNginxAccess() {
  const path = '/var/log/nginx/access.log';
  try {
    const raw = await readTail(path, 1200);
    const lines = raw.split('\n').filter(Boolean);
    const teams = lines.filter((line) => line.includes('/api/teams/messages'));
    const health = lines.filter((line) => line.includes('/api/teams/health'));
    const bad = teams.filter((line) => /" (5\d\d|499) /.test(line));
    const last = teams.at(-1) || health.at(-1);
    const status = bad.length ? 'warn' : teams.length ? 'ok' : 'warn';
    addCheck('Nginx Teams', status, `sampleLines=${lines.length} messages=${teams.length} health=${health.length} 5xxOr499=${bad.length} last="${(last || 'n/a').slice(0, 160)}"`);
  } catch (error) {
    addCheck('Nginx Teams', 'warn', `No se pudo leer ${path}: ${error.message}`);
  }
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

async function main() {
  console.log('Sophia operational monitor');
  console.log(`Directorio: ${process.cwd()}`);
  console.log(`Fecha: ${new Date().toISOString()}`);
  console.log(`Ventana: ultimos ${WINDOW_MINUTES} minutos`);
  console.log('');

  await checkPm2Sophia();
  await checkBackendHealth();
  await checkTeamsAudit();
  await checkToolAudit();
  await checkSdpDebug();
  await checkNginxAccess();

  const width = Math.max(...checks.map((check) => check.name.length), 10);
  for (const check of checks) {
    console.log(`${icon(check.status)} ${check.name.padEnd(width)} ${check.detail}`);
  }

  const failed = checks.filter((check) => check.status === 'fail');
  const warned = checks.filter((check) => check.status === 'warn');
  console.log('');
  console.log(`Resumen: ${checks.length - failed.length - warned.length} OK, ${warned.length} WARN, ${failed.length} FAIL`);

  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Error ejecutando monitor: ${error.message}`);
  process.exitCode = 1;
});
