import { mkdtemp, mkdir, rm, stat, chmod, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const BACKUP_ROOT = process.env.SOPHIA_BACKUP_DIR || '/opt/sophia/backups';
const PROJECT_ROOT = process.cwd();
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const backupName = `sophia-backup-${timestamp}`;
const archivePath = join(BACKUP_ROOT, `${backupName}.tar.gz`);

const candidates = [
  ['.env', '.env'],
  ['data/runtime-state.json', 'data/runtime-state.json'],
  ['teams/generated/soporte-it-teams.zip', 'teams/generated/soporte-it-teams.zip'],
  ['audit.log', 'logs/audit.log'],
  ['teams-audit.log', 'logs/teams-audit.log'],
  ['sdp-debug.log', 'logs/sdp-debug.log'],
  ['/etc/systemd/system/sophia.service', 'systemd/sophia.service'],
  ['/etc/nginx/sites-enabled/sophia', 'nginx/sites-enabled/sophia'],
  ['/etc/nginx/sites-available/sophia', 'nginx/sites-available/sophia'],
  ['/etc/logrotate.d/sophia', 'logrotate/sophia'],
];

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options.timeout ?? 30000,
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

async function readable(path) {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

async function copyIntoStaging(source, target, stagingDir) {
  const destination = join(stagingDir, target);
  await mkdir(dirname(destination), { recursive: true });

  const result = await run('cp', ['-p', source, destination]);
  if (result.ok) return true;

  if (await commandExists('sudo')) {
    const sudoResult = await run('sudo', ['-n', 'cp', '-p', source, destination]);
    if (sudoResult.ok) {
      await run('sudo', ['-n', 'chown', `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`, destination]);
      return true;
    }
  }

  return false;
}

async function main() {
  if (!(await commandExists('tar'))) {
    throw new Error('tar no esta disponible en este servidor.');
  }

  await mkdir(BACKUP_ROOT, { recursive: true, mode: 0o700 });
  const stagingDir = await mkdtemp(join(tmpdir(), `${backupName}-`));
  const copied = [];
  const skipped = [];

  try {
    for (const [source, target] of candidates) {
      const absoluteSource = source.startsWith('/') ? source : join(PROJECT_ROOT, source);
      if (!(await readable(absoluteSource))) {
        skipped.push(`${source} (no existe o no es legible)`);
        continue;
      }

      const ok = await copyIntoStaging(absoluteSource, target, stagingDir);
      if (ok) {
        copied.push(`${source} -> ${target}`);
      } else {
        skipped.push(`${source} (sin permisos de lectura/copia)`);
      }
    }

    const manifest = {
      createdAt: new Date().toISOString(),
      projectRoot: PROJECT_ROOT,
      backupRoot: BACKUP_ROOT,
      archivePath,
      copied,
      skipped,
      note: 'Este respaldo puede contener secretos de produccion. Mantener con permisos restrictivos.',
    };
    await writeFile(join(stagingDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

    const tarResult = await run('tar', ['-czf', archivePath, '-C', stagingDir, '.'], { timeout: 60000 });
    if (!tarResult.ok) {
      throw new Error(tarResult.stderr || tarResult.stdout || 'No se pudo crear el tar.gz');
    }
    await chmod(archivePath, 0o600);

    console.log(`Backup creado: ${archivePath}`);
    console.log('');
    console.log('Archivos incluidos:');
    for (const item of copied) console.log(`  - ${item}`);
    console.log('');
    console.log('Omitidos:');
    if (skipped.length) {
      for (const item of skipped) console.log(`  - ${item}`);
    } else {
      console.log('  - ninguno');
    }
    console.log('');
    console.log('Nota: este archivo puede contener secretos. Mantener permisos 0600 y no subirlo a git.');
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Error creando backup: ${error.message}`);
  process.exitCode = 1;
});
