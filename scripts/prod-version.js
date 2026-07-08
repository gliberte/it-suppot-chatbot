import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const BACKUP_ROOT = process.env.SOPHIA_BACKUP_DIR || '/opt/sophia/backups';

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

async function main() {
  const [
    branch,
    commit,
    commitDate,
    commitSubject,
    workingTree,
    sophiaState,
    nginxState,
    backup,
  ] = await Promise.all([
    gitValue(['branch', '--show-current']),
    gitValue(['rev-parse', '--short', 'HEAD']),
    gitValue(['show', '-s', '--format=%cI', 'HEAD']),
    gitValue(['show', '-s', '--format=%s', 'HEAD']),
    gitValue(['status', '--short']),
    serviceState('sophia'),
    serviceState('nginx'),
    latestBackup(),
  ]);

  console.log('Sophia production version');
  console.log(`Directorio: ${process.cwd()}`);
  console.log(`Fecha: ${new Date().toISOString()}`);
  console.log('');
  console.log(`Rama: ${branch || 'n/a'}`);
  console.log(`Commit: ${commit}`);
  console.log(`Fecha commit: ${commitDate}`);
  console.log(`Mensaje: ${commitSubject}`);
  console.log(`Working tree: ${workingTree ? 'con cambios locales' : 'limpio'}`);
  if (workingTree) {
    console.log(workingTree);
  }
  console.log(`Servicio sophia: ${sophiaState}`);
  console.log(`Servicio nginx: ${nginxState}`);
  console.log(`Ultimo backup: ${backup}`);
}

main().catch((error) => {
  console.error(`Error consultando version: ${error.message}`);
  process.exitCode = 1;
});
