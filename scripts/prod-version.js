import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const BACKUP_ROOT = process.env.SOPHIA_BACKUP_DIR || '/opt/sophia/backups';
const CHANGELOG_PATH = 'CHANGELOG.md';
const PACKAGE_JSON_PATH = 'package.json';

async function run(command, args = [], options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options.timeout ?? 10000,
      maxBuffer: options.maxBuffer ?? 1024 * 1024,
    });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout || '').trim(),
      stderr: String(error.stderr || error.message || '').trim(),
    };
  }
}

async function commandExists(command) {
  const result = await run('sh', ['-lc', `command -v ${command}`], { timeout: 5000 });
  return result.ok;
}

async function gitValue(args, fallback = 'n/a') {
  const result = await run('git', args);
  return result.ok && result.stdout ? result.stdout : fallback;
}

async function serviceState(name) {
  if (!(await commandExists('systemctl'))) return 'systemctl no disponible';
  const result = await run('systemctl', ['is-active', name]);
  return result.ok && result.stdout ? result.stdout : 'inactive/unavailable';
}

async function pm2AppState(name) {
  if (!(await commandExists('pm2'))) return 'pm2 no disponible';
  const result = await run('pm2', ['jlist'], { timeout: 10000, maxBuffer: 5 * 1024 * 1024 });
  if (!result.ok || !result.stdout) return 'pm2 no disponible';

  try {
    const apps = JSON.parse(result.stdout);
    const app = apps.find((candidate) => candidate.name === name);
    if (!app) return 'no encontrado en pm2';
    return [
      app.pm2_env?.status || 'unknown',
      `pid=${app.pid || 'n/a'}`,
      `restarts=${app.pm2_env?.restart_time ?? 'n/a'}`
    ].join(' ');
  } catch (error) {
    return `pm2 parse error: ${error.message}`;
  }
}

async function latestBackup() {
  try {
    const entries = await readdir(BACKUP_ROOT);
    const backups = [];
    for (const entry of entries.filter((name) => name.endsWith('.tar.gz'))) {
      const path = join(BACKUP_ROOT, entry);
      const info = await stat(path);
      backups.push({ path, mtime: info.mtime, size: info.size });
    }

    backups.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const latest = backups[0];
    if (!latest) return 'no hay backups .tar.gz';
    return `${latest.path} (${latest.size} bytes, ${latest.mtime.toISOString()})`;
  } catch (error) {
    return `no disponible: ${error.message}`;
  }
}

async function packageVersion() {
  try {
    const pkg = JSON.parse(await readFile(PACKAGE_JSON_PATH, 'utf8'));
    return pkg.version || 'n/a';
  } catch (error) {
    return `no disponible: ${error.message}`;
  }
}

async function latestChangelogEntry() {
  try {
    const changelog = await readFile(CHANGELOG_PATH, 'utf8');
    const lines = changelog.split('\n');
    const start = lines.findIndex((line) => /^##\s+\[[^\]]+\]/.test(line));
    if (start === -1) return 'no hay entrada de changelog';
    const rest = lines.slice(start + 1);
    const next = rest.findIndex((line) => /^##\s+\[[^\]]+\]/.test(line));
    const entryLines = lines.slice(start, next === -1 ? lines.length : start + 1 + next);
    return entryLines
      .slice(0, 24)
      .join('\n')
      .trim();
  } catch (error) {
    return `no disponible: ${error.message}`;
  }
}

async function main() {
  const [
    version,
    branch,
    commit,
    commitDate,
    commitSubject,
    workingTree,
    sophiaPm2State,
    sophiaState,
    nginxState,
    backup,
    changelog,
  ] = await Promise.all([
    packageVersion(),
    gitValue(['branch', '--show-current']),
    gitValue(['rev-parse', '--short', 'HEAD']),
    gitValue(['show', '-s', '--format=%cI', 'HEAD']),
    gitValue(['show', '-s', '--format=%s', 'HEAD']),
    gitValue(['status', '--short']),
    pm2AppState('sophia'),
    serviceState('sophia'),
    serviceState('nginx'),
    latestBackup(),
    latestChangelogEntry(),
  ]);

  console.log('Sophia production version');
  console.log(`Directorio: ${process.cwd()}`);
  console.log(`Fecha: ${new Date().toISOString()}`);
  console.log('');
  console.log(`Version Sophia: ${version}`);
  console.log(`Rama: ${branch || 'n/a'}`);
  console.log(`Commit: ${commit}`);
  console.log(`Fecha commit: ${commitDate}`);
  console.log(`Mensaje: ${commitSubject}`);
  console.log(`Working tree: ${workingTree ? 'con cambios locales' : 'limpio'}`);
  if (workingTree) {
    console.log(workingTree);
  }
  console.log(`PM2 sophia: ${sophiaPm2State}`);
  console.log(`Servicio sophia systemd: ${sophiaState}`);
  console.log(`Servicio nginx: ${nginxState}`);
  console.log(`Ultimo backup: ${backup}`);
  console.log('');
  console.log('Ultima entrada de changelog:');
  console.log(changelog);
}

main().catch((error) => {
  console.error(`Error consultando version: ${error.message}`);
  process.exitCode = 1;
});
