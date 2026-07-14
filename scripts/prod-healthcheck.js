import { existsSync } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const checks = [];

function addCheck(name, status, detail = '') {
  checks.push({ name, status, detail });
}

function icon(status) {
  if (status === 'ok') return '[OK]';
  if (status === 'warn') return '[WARN]';
  return '[FAIL]';
}

async function commandExists(command) {
  try {
    await execFileAsync('sh', ['-lc', `command -v ${command}`], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function run(command, args = [], options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options.timeout ?? 10000,
      maxBuffer: options.maxBuffer ?? 1024 * 1024,
    });
    return {
      ok: true,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  } catch (error) {
    return {
      ok: false,
      code: error.code,
      stdout: String(error.stdout || '').trim(),
      stderr: String(error.stderr || error.message || '').trim(),
    };
  }
}

async function checkFile(path, label) {
  try {
    await access(path);
    addCheck(label, 'ok', path);
  } catch {
    addCheck(label, 'warn', `No encontrado: ${path}`);
  }
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function objectKeyCount(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).length
    : 0;
}

function formatMode(mode) {
  return `0${(mode & 0o777).toString(8)}`;
}

function parseJsonLines(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function summarizeAuditEvent(event) {
  const parts = [
    event.timestamp,
    event.outcome,
    event.from?.name,
    event.messagePreview ? `msg="${event.messagePreview}"` : '',
    event.replyPreview ? `reply="${event.replyPreview}"` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

async function checkSystemdService(name) {
  if (!(await commandExists('systemctl'))) {
    addCheck(`Servicio ${name}`, 'warn', 'systemctl no disponible en este entorno');
    return;
  }

  const active = await run('systemctl', ['is-active', name]);
  if (active.ok && active.stdout === 'active') {
    addCheck(`Servicio ${name}`, 'ok', 'active');
    return;
  }

  const status = await run('systemctl', ['status', name, '--no-pager'], { timeout: 10000 });
  const detail = [active.stdout, active.stderr, status.stdout, status.stderr]
    .filter(Boolean)
    .join('\n')
    .split('\n')
    .slice(0, 8)
    .join(' | ');

  addCheck(`Servicio ${name}`, 'fail', detail || 'No activo o no encontrado');
}

async function getPm2App(name) {
  if (!(await commandExists('pm2'))) return null;

  const result = await run('pm2', ['jlist'], { timeout: 10000, maxBuffer: 5 * 1024 * 1024 });
  if (!result.ok || !result.stdout) return null;

  try {
    const apps = JSON.parse(result.stdout);
    return apps.find((app) => app.name === name) || null;
  } catch {
    return null;
  }
}

async function getSystemdServiceState(name) {
  if (!(await commandExists('systemctl'))) return 'unavailable';
  const active = await run('systemctl', ['is-active', name]);
  return active.ok && active.stdout === 'active' ? 'active' : 'inactive';
}

async function checkSophiaProcess() {
  const pm2App = await getPm2App('sophia');
  if (pm2App) {
    const status = pm2App.pm2_env?.status || 'unknown';
    const restarts = pm2App.pm2_env?.restart_time ?? 'n/a';
    const uptimeMs = pm2App.pm2_env?.pm_uptime ? Date.now() - pm2App.pm2_env.pm_uptime : 0;
    const detail = [
      `pm2=${status}`,
      `pid=${pm2App.pid || 'n/a'}`,
      `restarts=${restarts}`,
      uptimeMs ? `uptimeMin=${Math.floor(uptimeMs / 60000)}` : ''
    ].filter(Boolean).join(' ');

    addCheck('Proceso Sophia', status === 'online' ? 'ok' : 'fail', detail);
    return;
  }

  const systemdState = await getSystemdServiceState('sophia');
  if (systemdState === 'active') {
    addCheck('Proceso Sophia', 'ok', 'systemd=sophia active');
    return;
  }

  addCheck('Proceso Sophia', 'fail', 'No se encontro Sophia activa en PM2 ni systemd');
}

async function checkPort443() {
  if (!(await commandExists('ss'))) {
    addCheck('Puerto 443', 'warn', 'ss no disponible en este entorno');
    return;
  }

  const result = await run('sh', ['-lc', "ss -tulpn 2>/dev/null | grep ':443' || true"]);
  if (result.stdout.includes(':443')) {
    addCheck('Puerto 443', 'ok', result.stdout.split('\n')[0]);
  } else {
    addCheck('Puerto 443', 'fail', 'No se detecto ningun proceso escuchando en 443');
  }
}

async function checkHttp(url, label, extraArgs = []) {
  if (!(await commandExists('curl'))) {
    addCheck(label, 'warn', 'curl no disponible en este entorno');
    return;
  }

  const result = await run('curl', [
    '-sS',
    '-m',
    '10',
    '-o',
    '/dev/null',
    '-w',
    '%{http_code}',
    ...extraArgs,
    url,
  ]);

  const statusCode = result.stdout.trim();
  if (result.ok && statusCode === '200') {
    addCheck(label, 'ok', `${url} -> ${statusCode}`);
    return;
  }

  const detail = [statusCode && `${url} -> ${statusCode}`, result.stderr]
    .filter(Boolean)
    .join(' | ');
  addCheck(label, 'fail', detail || `No hubo respuesta valida desde ${url}`);
}

async function checkTeamsMessagesRoute() {
  if (!(await commandExists('curl'))) {
    addCheck('Teams messages route', 'warn', 'curl no disponible en este entorno');
    return;
  }

  const url = 'https://localhost/api/teams/messages';
  const result = await run('curl', [
    '-k',
    '-sS',
    '-m',
    '10',
    '-o',
    '/dev/null',
    '-w',
    '%{http_code}',
    '-X',
    'POST',
    '-H',
    'Content-Type: application/json',
    '-d',
    '{}',
    url,
  ]);

  const statusCode = result.stdout.trim();
  if (['400', '401', '403'].includes(statusCode)) {
    addCheck('Teams messages route', 'ok', `${url} -> ${statusCode} esperado sin firma Bot Framework`);
    return;
  }

  if (statusCode === '404') {
    addCheck('Teams messages route', 'fail', `${url} -> 404. Revisar ruta/proxy Nginx hacia Express`);
    return;
  }

  const detail = [statusCode && `${url} -> ${statusCode}`, result.stderr]
    .filter(Boolean)
    .join(' | ');
  addCheck('Teams messages route', result.ok ? 'warn' : 'fail', detail || `No hubo respuesta desde ${url}`);
}

async function checkNginxConfig() {
  if (!(await commandExists('nginx'))) {
    addCheck('Nginx config', 'warn', 'nginx no disponible en este entorno');
    return;
  }

  const sudoAvailable = await commandExists('sudo');
  const result = sudoAvailable
    ? await run('sudo', ['-n', 'nginx', '-t'])
    : await run('nginx', ['-t']);

  if (result.ok) {
    addCheck('Nginx config', 'ok', `${sudoAvailable ? 'sudo -n ' : ''}nginx -t exitoso`);
    return;
  }

  const output = result.stderr || result.stdout || '';
  if (
    output.includes('Permission denied')
    || output.includes('a password is required')
    || output.includes('interactive authentication is required')
  ) {
    addCheck('Nginx config', 'warn', 'No se pudo validar nginx -t sin privilegios. Ejecutar manualmente: sudo nginx -t');
    return;
  }

  addCheck('Nginx config', 'fail', output || 'nginx -t fallo');
}

async function checkEnv() {
  await checkFile('.env', '.env');

  if (!existsSync('.env')) return;

  const result = await run('sh', [
    '-lc',
    "grep -E '^(MICROSOFT_APP_ID|MICROSOFT_APP_TYPE|AZURE_TENANT_ID|PUBLIC_APP_DOMAIN|TEAMS_ALLOWED_TENANT_IDS|TEAMS_ALLOWED_CONVERSATION_IDS|TEAMS_DEV_TEST_TOKEN|TEAMS_GRAPH_USER_LOOKUP)=' .env",
  ]);

  const lines = result.stdout.split('\n').filter(Boolean);
  const expected = new Map(lines.map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));

  const issues = [];
  if (expected.get('MICROSOFT_APP_TYPE') !== 'SingleTenant') {
    issues.push('MICROSOFT_APP_TYPE debe ser SingleTenant');
  }
  if (expected.get('PUBLIC_APP_DOMAIN') !== 'sophia.barrazaycia.com') {
    issues.push('PUBLIC_APP_DOMAIN no es sophia.barrazaycia.com');
  }
  if (expected.get('TEAMS_DEV_TEST_TOKEN')) {
    issues.push('TEAMS_DEV_TEST_TOKEN deberia estar vacio en produccion');
  }
  if (expected.get('TEAMS_ALLOWED_CONVERSATION_IDS')) {
    issues.push('TEAMS_ALLOWED_CONVERSATION_IDS deberia estar vacio para chat personal');
  }
  if (expected.get('TEAMS_GRAPH_USER_LOOKUP') !== 'true') {
    issues.push('TEAMS_GRAPH_USER_LOOKUP debe ser true');
  }

  if (issues.length) {
    addCheck('Variables Teams produccion', 'warn', issues.join('; '));
  } else {
    addCheck('Variables Teams produccion', 'ok', 'Configuracion principal esperada');
  }
}

async function checkRecentLogs() {
  const logTargets = [
    ['audit.log', 'audit.log'],
    ['teams-audit.log', 'teams-audit.log'],
    ['sdp-debug.log', 'sdp-debug.log'],
  ];

  for (const [path, label] of logTargets) {
    await checkFile(path, label);
  }
}

async function checkRuntimeState() {
  const path = 'data/runtime-state.json';

  try {
    const [fileStat, raw] = await Promise.all([
      stat(path),
      readFile(path, 'utf8'),
    ]);
    const state = JSON.parse(raw);
    const mode = formatMode(fileStat.mode);
    const permissionStatus = mode === '0600' ? 'ok' : 'warn';
    const detail = [
      `size=${fileStat.size}B`,
      `mode=${mode}`,
      `uid=${fileStat.uid}`,
      `gid=${fileStat.gid}`,
      `sessions=${arrayLength(state.sessions)}`,
      `teamsSessions=${arrayLength(state.teamsSessions)}`,
      `pendingActions=${arrayLength(state.pendingActions)}`,
      `teamsHistory=${objectKeyCount(state.teamsHistory)}`,
      `savedAt=${state.savedAt || state.updatedAt || 'n/a'}`,
    ].join(' ');

    addCheck(
      'runtime-state.json',
      permissionStatus,
      permissionStatus === 'ok' ? detail : `${detail} | recomendado: chmod 600 ${path}`,
    );
  } catch (error) {
    addCheck('runtime-state.json', 'warn', `No se pudo leer ${path}: ${error.message}`);
  }
}

async function readTail(path, lines = 300) {
  const direct = await run('tail', ['-n', String(lines), path]);
  if (direct.ok) return direct.stdout;

  if (await commandExists('sudo')) {
    const viaSudo = await run('sudo', ['-n', 'tail', '-n', String(lines), path]);
    if (viaSudo.ok) return viaSudo.stdout;
  }

  throw new Error(direct.stderr || `No se pudo leer ${path}`);
}

async function checkNginxTeamsHits() {
  const path = '/var/log/nginx/access.log';

  try {
    const raw = await readTail(path, 500);
    const lines = raw.split('\n').filter(Boolean);
    const messageHits = lines.filter((line) => line.includes('/api/teams/messages'));
    const healthHits = lines.filter((line) => line.includes('/api/teams/health'));
    const lastMessage = messageHits.at(-1);
    const lastHealth = healthHits.at(-1);

    const detail = [
      `messages=${messageHits.length}`,
      `health=${healthHits.length}`,
      lastMessage ? `lastMessage="${lastMessage.slice(0, 180)}"` : 'lastMessage=n/a',
      !lastMessage && lastHealth ? `lastHealth="${lastHealth.slice(0, 140)}"` : '',
    ].filter(Boolean).join(' ');

    addCheck('Nginx Teams hits', messageHits.length ? 'ok' : 'warn', detail);
  } catch (error) {
    addCheck('Nginx Teams hits', 'warn', `No se pudo leer ${path}: ${error.message}`);
  }
}

async function checkTeamsAuditSummary() {
  const path = 'teams-audit.log';

  if (!existsSync(path)) {
    addCheck('Teams audit reciente', 'warn', `No encontrado: ${path}`);
    return;
  }

  try {
    const raw = await readTail(path, 80);
    const events = parseJsonLines(raw);
    const messageEvents = events.filter((event) => event.outcome === 'message_received');
    const replyEvents = events.filter((event) => event.outcome === 'reply_sent');
    const errorEvents = events.filter((event) => String(event.outcome || '').includes('error'));
    const lastEvent = events.at(-1);
    const detail = [
      `events=${events.length}`,
      `messages=${messageEvents.length}`,
      `replies=${replyEvents.length}`,
      `errors=${errorEvents.length}`,
      lastEvent ? `last="${summarizeAuditEvent(lastEvent).slice(0, 220)}"` : 'last=n/a',
    ].join(' ');

    addCheck('Teams audit reciente', events.length ? 'ok' : 'warn', detail);
  } catch (error) {
    addCheck('Teams audit reciente', 'warn', `No se pudo leer ${path}: ${error.message}`);
  }
}

async function main() {
  console.log('Sophia production healthcheck');
  console.log(`Directorio: ${process.cwd()}`);
  console.log(`Fecha: ${new Date().toISOString()}`);
  console.log('');

  await checkSophiaProcess();
  await checkSystemdService('nginx');
  await checkNginxConfig();
  await checkPort443();
  await checkHttp('http://localhost:3001/api/teams/health', 'Backend local');
  await checkHttp('https://localhost/api/teams/health', 'HTTPS local via Nginx', ['-k']);
  await checkTeamsMessagesRoute();
  await checkEnv();
  await checkRecentLogs();
  await checkRuntimeState();
  await checkNginxTeamsHits();
  await checkTeamsAuditSummary();

  const width = Math.max(...checks.map((check) => check.name.length), 10);
  for (const check of checks) {
    console.log(`${icon(check.status)} ${check.name.padEnd(width)} ${check.detail}`);
  }

  const failed = checks.filter((check) => check.status === 'fail');
  const warned = checks.filter((check) => check.status === 'warn');

  console.log('');
  console.log(`Resumen: ${checks.length - failed.length - warned.length} OK, ${warned.length} WARN, ${failed.length} FAIL`);

  if (failed.length) {
    console.log('');
    console.log('Siguiente paso sugerido: revisar los checks FAIL y luego ejecutar:');
    console.log('  pm2 logs sophia --lines 120');
    console.log('  sudo journalctl -u sophia -n 120 --no-pager  # solo si aun usas systemd legado');
    console.log('  sudo tail -n 80 /var/log/nginx/error.log');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
