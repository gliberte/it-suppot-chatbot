import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

const LOG_PATH = resolve(process.env.AUDIT_LOG_PATH || 'audit.log');
const FORMAT = getArgValue('--format') || 'table';
const OUTPUT = getArgValue('--output');
const LIMIT = Number(getArgValue('--limit') || process.env.AUDIT_REPORT_LIMIT || 50);
const SINCE = getArgValue('--since');
const ONLY_CONFIRMED = hasFlag('--confirmed');
const ONLY_ERRORS = hasFlag('--errors');

if (!existsSync(LOG_PATH)) {
  console.error(`No existe el archivo de auditoría: ${LOG_PATH}`);
  process.exit(1);
}

const records = readAuditRecords(LOG_PATH)
  .filter((record) => record.toolName === 'sdp_create_request')
  .filter((record) => !ONLY_CONFIRMED || ['confirmed_success', 'success'].includes(record.outcome))
  .filter((record) => !ONLY_ERRORS || record.outcome.includes('error') || record.error)
  .filter((record) => !SINCE || new Date(record.timestamp) >= new Date(SINCE))
  .slice(-LIMIT);

const rows = records.map(toReportRow);

if (FORMAT === 'json') {
  writeOrPrint(JSON.stringify(rows, null, 2));
} else if (FORMAT === 'md' || FORMAT === 'markdown') {
  writeOrPrint(renderMarkdown(rows));
} else {
  writeOrPrint(renderTable(rows));
}

function readAuditRecords(logPath) {
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
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
