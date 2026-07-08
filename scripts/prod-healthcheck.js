import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
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
  if (output.includes('Permission denied') || output.includes('a password is required')) {
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
    ['data/runtime-state.json', 'runtime-state.json'],
  ];

  for (const [path, label] of logTargets) {
    await checkFile(path, label);
  }
}

async function main() {
  console.log('Sophia production healthcheck');
  console.log(`Directorio: ${process.cwd()}`);
  console.log(`Fecha: ${new Date().toISOString()}`);
  console.log('');

  await checkSystemdService('sophia');
  await checkSystemdService('nginx');
  await checkNginxConfig();
  await checkPort443();
  await checkHttp('http://localhost:3001/api/teams/health', 'Backend local');
  await checkHttp('https://localhost/api/teams/health', 'HTTPS local via Nginx', ['-k']);
  await checkEnv();
  await checkRecentLogs();

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
    console.log('  sudo journalctl -u sophia -n 120 --no-pager');
    console.log('  sudo tail -n 80 /var/log/nginx/error.log');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
