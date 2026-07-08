import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const steps = [
  {
    title: 'Version actual',
    command: 'npm',
    args: ['run', 'prod:version'],
  },
  {
    title: 'Sintaxis backend',
    command: 'node',
    args: ['--check', 'server.js'],
  },
  {
    title: 'Sintaxis scripts operativos',
    command: 'sh',
    args: ['-lc', 'node --check scripts/prod-healthcheck.js && node --check scripts/prod-backup.js && node --check scripts/prod-version.js'],
  },
  {
    title: 'Build aplicacion',
    command: 'npm',
    args: ['run', 'build'],
  },
  {
    title: 'Healthcheck produccion',
    command: 'npm',
    args: ['run', 'prod:check'],
  },
];

async function runStep(step) {
  console.log('');
  console.log(`== ${step.title} ==`);
  console.log(`$ ${step.command} ${step.args.join(' ')}`);

  try {
    const result = await execFileAsync(step.command, step.args, {
      timeout: step.timeout ?? 120000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.stdout.trim()) console.log(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
    console.log(`[OK] ${step.title}`);
    return true;
  } catch (error) {
    if (error.stdout?.trim()) console.log(error.stdout.trim());
    if (error.stderr?.trim()) console.error(error.stderr.trim());
    console.error(`[FAIL] ${step.title}`);
    return false;
  }
}

async function main() {
  console.log('Sophia production deploy check');
  console.log(`Directorio: ${process.cwd()}`);
  console.log(`Fecha: ${new Date().toISOString()}`);
  console.log('');
  console.log('Este comando no ejecuta git pull, no crea backups, no reinicia servicios y no modifica configuracion.');

  for (const step of steps) {
    const ok = await runStep(step);
    if (!ok) {
      console.log('');
      console.log('Deploy check detenido. Revisa el paso fallido antes de continuar.');
      process.exitCode = 1;
      return;
    }
  }

  console.log('');
  console.log('Deploy check completado.');
  console.log('');
  console.log('Flujo manual recomendado para desplegar cambios:');
  console.log('  npm run prod:backup');
  console.log('  git pull');
  console.log('  npm install');
  console.log('  npm run build');
  console.log('  sudo systemctl restart sophia');
  console.log('  npm run prod:check');
  console.log('  npm run prod:version');
  console.log('');
  console.log('Endpoint Azure Bot esperado:');
  console.log('  https://sophia.barrazaycia.com/api/teams/messages');
}

main().catch((error) => {
  console.error(`Error ejecutando deploy check: ${error.message}`);
  process.exitCode = 1;
});
