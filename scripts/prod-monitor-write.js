import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const REPORT_DIR = resolve(process.env.SOPHIA_MONITOR_REPORT_DIR || 'reports');
const LATEST_PATH = resolve(process.env.SOPHIA_MONITOR_LATEST_PATH || `${REPORT_DIR}/prod-monitor-latest.txt`);
const HISTORY_PATH = resolve(process.env.SOPHIA_MONITOR_HISTORY_PATH || `${REPORT_DIR}/prod-monitor-history.log`);
const WINDOW_MINUTES = getArgValue('--minutes') || process.env.SOPHIA_MONITOR_WINDOW_MINUTES || '60';

async function runMonitor() {
  try {
    const result = await execFileAsync('node', ['scripts/prod-monitor.js', '--minutes', WINDOW_MINUTES], {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      exitCode: 0,
      output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    };
  } catch (error) {
    return {
      exitCode: typeof error.code === 'number' ? error.code : 1,
      output: [
        error.stdout,
        error.stderr,
        !error.stdout && !error.stderr ? error.message : ''
      ].filter(Boolean).join('\n').trim()
    };
  }
}

function buildHistoryEntry({ output, exitCode }) {
  const timestamp = new Date().toISOString();
  return [
    '',
    `===== ${timestamp} exitCode=${exitCode} window=${WINDOW_MINUTES}m =====`,
    output,
    `===== end ${timestamp} =====`,
    ''
  ].join('\n');
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

async function main() {
  await mkdir(dirname(LATEST_PATH), { recursive: true });
  await mkdir(dirname(HISTORY_PATH), { recursive: true });

  const result = await runMonitor();
  const output = result.output || 'prod-monitor no produjo salida.';

  await writeFile(LATEST_PATH, `${output}\n`, 'utf8');
  await appendFile(HISTORY_PATH, buildHistoryEntry({ output, exitCode: result.exitCode }), 'utf8');

  console.log(`Reporte actualizado: ${LATEST_PATH}`);
  console.log(`Historico actualizado: ${HISTORY_PATH}`);
  console.log(`Exit code monitor: ${result.exitCode}`);

  process.exitCode = result.exitCode;
}

main().catch((error) => {
  console.error(`Error escribiendo reporte de monitor: ${error.message}`);
  process.exitCode = 1;
});
