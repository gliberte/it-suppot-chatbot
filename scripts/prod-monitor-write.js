import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const REPORT_DIR = resolve(process.env.SOPHIA_MONITOR_REPORT_DIR || 'reports');
const LATEST_PATH = resolve(process.env.SOPHIA_MONITOR_LATEST_PATH || `${REPORT_DIR}/prod-monitor-latest.txt`);
const HISTORY_PATH = resolve(process.env.SOPHIA_MONITOR_HISTORY_PATH || `${REPORT_DIR}/prod-monitor-history.log`);
const ALERTS_PATH = resolve(process.env.SOPHIA_MONITOR_ALERTS_PATH || `${REPORT_DIR}/prod-monitor-alerts.log`);
const STATE_PATH = resolve(process.env.SOPHIA_MONITOR_STATE_PATH || `${REPORT_DIR}/prod-monitor-state.json`);
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

function extractProblemLines(output) {
  return output
    .split('\n')
    .filter((line) => /^\[(FAIL|WARN)\]/.test(line))
    .map((line) => line.trim());
}

function createAlertSignature(problemLines) {
  return problemLines
    .map((line) => line.replace(/\s+/g, ' '))
    .sort()
    .join('\n');
}

async function readPreviousState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function buildAlertEntry({ problemLines, previousState, signature, exitCode }) {
  const timestamp = new Date().toISOString();
  const status = problemLines.length ? 'active' : 'clear';
  const transition = previousState.signature && previousState.signature !== signature
    ? 'changed'
    : previousState.signature === signature
      ? 'unchanged'
      : 'new';

  return [
    JSON.stringify({
      timestamp,
      status,
      transition,
      exitCode,
      problemCount: problemLines.length,
      previousProblemCount: previousState.problemCount || 0,
      problems: problemLines
    }),
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
  await mkdir(dirname(ALERTS_PATH), { recursive: true });
  await mkdir(dirname(STATE_PATH), { recursive: true });

  const result = await runMonitor();
  const output = result.output || 'prod-monitor no produjo salida.';
  const problemLines = extractProblemLines(output);
  const signature = createAlertSignature(problemLines);
  const previousState = await readPreviousState();
  const shouldWriteAlert = previousState.signature !== signature;

  await writeFile(LATEST_PATH, `${output}\n`, 'utf8');
  await appendFile(HISTORY_PATH, buildHistoryEntry({ output, exitCode: result.exitCode }), 'utf8');
  await writeFile(STATE_PATH, `${JSON.stringify({
    updatedAt: new Date().toISOString(),
    exitCode: result.exitCode,
    problemCount: problemLines.length,
    signature,
    problems: problemLines
  }, null, 2)}\n`, 'utf8');

  if (shouldWriteAlert) {
    await appendFile(ALERTS_PATH, buildAlertEntry({
      problemLines,
      previousState,
      signature,
      exitCode: result.exitCode
    }), 'utf8');
  }

  console.log(`Reporte actualizado: ${LATEST_PATH}`);
  console.log(`Historico actualizado: ${HISTORY_PATH}`);
  console.log(`Estado actualizado: ${STATE_PATH}`);
  console.log(shouldWriteAlert
    ? `Alerta registrada: ${ALERTS_PATH}`
    : `Sin cambios de alerta: ${ALERTS_PATH}`);
  console.log(`Exit code monitor: ${result.exitCode}`);

  process.exitCode = result.exitCode;
}

main().catch((error) => {
  console.error(`Error escribiendo reporte de monitor: ${error.message}`);
  process.exitCode = 1;
});
