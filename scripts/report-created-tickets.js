import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { gunzipSync } from 'zlib';

// audit.log rota a diario y comprime (deploy/logrotate/sophia: daily, rotate 14, compress,
// delaycompress). Por defecto se fusiona el activo + todos los rotados que existan (mismo patrón
// que report-teams-users.js / get-teams-transcript.js / report-followup-coverage.js / qa-tickets.js).
const ROTATED_LOOKBACK = 30;

const LOG_PATH = resolve(process.env.AUDIT_LOG_PATH || 'audit.log');
const FORMAT = getArgValue('--format') || 'table';
const OUTPUT = getArgValue('--output');
const LIMIT = Number(getArgValue('--limit') || process.env.AUDIT_REPORT_LIMIT || 50);
const SINCE = getArgValue('--since');
const UNTIL = getArgValue('--until');
const ONLY_CONFIRMED = hasFlag('--confirmed');
const ONLY_ERRORS = hasFlag('--errors');
const INCLUDE_ROTATED = !hasFlag('--no-rotated');

if (!existsSync(LOG_PATH)) {
  console.error(`No existe el archivo de auditoría: ${LOG_PATH}`);
  process.exit(1);
}

const sinceBoundary = SINCE ? parseBoundary(SINCE, false) : null;
const untilBoundary = UNTIL ? parseBoundary(UNTIL, true) : null;

const records = readAuditRecords(LOG_PATH, INCLUDE_ROTATED)
  .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())
  .filter((record) => record.toolName === 'sdp_create_request')
  .filter((record) => !ONLY_CONFIRMED || ['confirmed_success', 'success'].includes(record.outcome))
  .filter((record) => !ONLY_ERRORS || String(record.outcome || '').includes('error') || record.error)
  .filter((record) => {
    const recordTime = new Date(record.timestamp || 0).getTime();
    if (sinceBoundary !== null && recordTime < sinceBoundary) return false;
    if (untilBoundary !== null && recordTime > untilBoundary) return false;
    return true;
  })
  .slice(-LIMIT);

const rows = records.map(toReportRow);

if (FORMAT === 'json') {
  writeOrPrint(JSON.stringify(rows, null, 2));
} else if (FORMAT === 'md' || FORMAT === 'markdown') {
  writeOrPrint(renderMarkdown(rows));
} else {
  writeOrPrint(renderTable(rows));
}

function readAuditRecords(basePath, includeRotated) {
  const files = [basePath];
  if (includeRotated) {
    for (let i = 1; i <= ROTATED_LOOKBACK; i += 1) {
      const plain = `${basePath}.${i}`;
      const gz = `${basePath}.${i}.gz`;
      if (existsSync(plain)) files.push(plain);
      else if (existsSync(gz)) files.push(gz);
    }
  }

  const records = [];
  for (const file of files) {
    let content;
    try {
      content = file.endsWith('.gz')
        ? gunzipSync(readFileSync(file)).toString('utf8')
        : readFileSync(file, 'utf8');
    } catch (error) {
      console.error(`Error leyendo ${file}: ${error.message}`);
      continue;
    }
    for (const line of content.split('\n')) {
      if (!line) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // línea corrupta o parcial -- se ignora
      }
    }
  }
  return records;
}

function parseBoundary(value, isUntil) {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  const d = new Date(isDateOnly && isUntil ? `${value.trim()}T23:59:59.999` : value);
  if (Number.isNaN(d.getTime())) {
    console.error(`Fecha inválida: "${value}"`);
    process.exit(1);
  }
  return d.getTime();
}

function toReportRow(record) {
  const classification = record.args?.sophia_classification || {};
  return {
    timestamp: record.timestamp,
    outcome: record.outcome,
    requestId: record.args?.request_id || '',
    user: record.user?.name || '',
    role: record.user?.role || '',
    subject: record.args?.subject || '',
    category: record.args?.category || '',
    subcategory: record.args?.subcategory || '',
    priority: record.args?.priority || '',
    routing: classification.routing || '',
    confidence: classification.confidence || '',
    matchedKeywords: Array.isArray(classification.matchedKeywords)
      ? classification.matchedKeywords.join(', ')
      : '',
    evidenceSource: classification.evidenceSource || '',
    evidenceScore: classification.evidenceScore ?? '',
    error: formatError(record.error)
  };
}

function renderTable(rows) {
  if (!rows.length) return 'No hay tickets creados en audit.log con los filtros indicados.';

  const columns = [
    ['timestamp', 'Fecha'],
    ['outcome', 'Resultado'],
    ['requestId', 'Ticket'],
    ['user', 'Usuario'],
    ['category', 'Categoría'],
    ['subcategory', 'Subcategoría'],
    ['routing', 'Ruta'],
    ['confidence', 'Confianza'],
    ['evidenceSource', 'Fuente'],
    ['error', 'Error'],
    ['subject', 'Asunto']
  ];

  return renderFixedTable(rows, columns);
}

function renderMarkdown(rows) {
  if (!rows.length) return 'No hay tickets creados en audit.log con los filtros indicados.\n';

  const header = [
    'Fecha',
    'Resultado',
    'Ticket',
    'Usuario',
    'Categoría',
    'Subcategoría',
    'Ruta',
    'Confianza',
    'Fuente',
    'Error',
    'Asunto'
  ];
  const lines = [
    `| ${header.join(' |')} |`,
    `| ${header.map(() => '---').join(' | ')} |`
  ];

  for (const row of rows) {
    lines.push(`| ${[
      row.timestamp,
      row.outcome,
      row.requestId,
      row.user,
      row.category,
      row.subcategory,
      row.routing,
      row.confidence,
      row.evidenceSource,
      row.error,
      row.subject
    ].map(escapeMarkdownCell).join(' | ')} |`);
  }

  return `${lines.join('\n')}\n`;
}

function renderFixedTable(rows, columns) {
  const prepared = rows.map((row) => {
    const entry = {};
    for (const [key] of columns) {
      entry[key] = truncateCell(String(row[key] ?? ''), key === 'subject' ? 48 : 24);
    }
    return entry;
  });

  const widths = Object.fromEntries(columns.map(([key, label]) => [
    key,
    Math.max(label.length, ...prepared.map((row) => row[key].length))
  ]));

  const header = columns.map(([key, label]) => label.padEnd(widths[key])).join('  ');
  const separator = columns.map(([key]) => '-'.repeat(widths[key])).join('  ');
  const body = prepared.map((row) => columns.map(([key]) => row[key].padEnd(widths[key])).join('  '));
  return [header, separator, ...body].join('\n');
}

function truncateCell(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function escapeMarkdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function formatError(error) {
  if (!error) return '';
  const fields = Array.isArray(error.fields) && error.fields.length
    ? ` campos=${error.fields.join(',')}`
    : '';
  return `${error.message || 'Error'}${fields}`;
}

function writeOrPrint(content) {
  if (!OUTPUT) {
    console.log(content);
    return;
  }

  const outputPath = resolve(OUTPUT);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content);
  console.log(`Reporte generado: ${outputPath}`);
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}
