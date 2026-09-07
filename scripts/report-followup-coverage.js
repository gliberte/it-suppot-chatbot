// Cruza los tickets CREADOS por Sophia (audit.log, toolName=sdp_create_request) contra los
// avisos de seguimiento que en verdad se enviaron (teams-audit.log, outcome=reply_sent con el
// patrón de mensaje de lib/ticket-followups.js) para saber qué fracción de los tickets creados
// por Sophia efectivamente le devolvió avance a quien lo pidió, y cuáles quedaron mudos.
//
// La identidad del solicitante se toma de audit.log (record.user.name/email): es la persona que
// de verdad conversó con Sophia y para quien Sophia creó el ticket -- confirmado en vivo contra
// la API real que el `requester` de SDP no siempre coincide con el nombre en el asunto del
// ticket (alguien de soporte puede redactarlo a nombre de otra persona), así que el asunto NUNCA
// debe usarse para identificar al solicitante.
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { gunzipSync } from 'zlib';

const ROTATED_LOOKBACK = 30; // margen sobre el rotate 14 de deploy/logrotate/sophia

const AUDIT_LOG_PATH = resolve(getArgValue('--audit-log-path') || process.env.AUDIT_LOG_PATH || 'audit.log');
const TEAMS_AUDIT_LOG_PATH = resolve(getArgValue('--teams-audit-log-path') || process.env.TEAMS_AUDIT_LOG_PATH || 'teams-audit.log');
const SINCE = getArgValue('--since');
const UNTIL = getArgValue('--until');
const FORMAT = getArgValue('--format') || 'table'; // 'table', 'json', 'md'
const OUTPUT = getArgValue('--output');
const INCLUDE_ROTATED = !process.argv.includes('--no-rotated');
const ONLY_MISSING = process.argv.includes('--only-missing');

if (!existsSync(AUDIT_LOG_PATH)) {
  console.error(`No existe el archivo de auditoría: ${AUDIT_LOG_PATH}`);
  process.exit(1);
}
if (!existsSync(TEAMS_AUDIT_LOG_PATH)) {
  console.error(`No existe el archivo de auditoría de Teams: ${TEAMS_AUDIT_LOG_PATH}`);
  process.exit(1);
}

const sinceBoundary = parseSinceBoundary(SINCE);
const untilBoundary = parseUntilBoundary(UNTIL);

// 1. Tickets creados por Sophia (confirmados de verdad, no borradores ni intentos fallidos)
const auditRecords = readAuditRecords(AUDIT_LOG_PATH, INCLUDE_ROTATED);
const createdTickets = new Map(); // requestId -> { requestId, timestamp, name, email, subject, category }

for (const record of auditRecords) {
  if (record.toolName !== 'sdp_create_request') continue;
  if (!['confirmed_success', 'success'].includes(record.outcome)) continue;
  const requestId = String(record.args?.request_id || '');
  if (!requestId) continue; // sin ID confirmado por SDP, no se puede rastrear

  const recordTime = new Date(record.timestamp).getTime();
  if (sinceBoundary !== null && recordTime < sinceBoundary) continue;
  if (untilBoundary !== null && recordTime > untilBoundary) continue;

  createdTickets.set(requestId, {
    requestId,
    timestamp: record.timestamp,
    name: record.user?.name || '(desconocido)',
    email: record.user?.email || '',
    subject: record.args?.subject || '',
    category: record.args?.category || ''
  });
}

// 2. Avisos de seguimiento realmente enviados (ver lib/ticket-followups.js:createTicketFollowupMessage)
const FOLLOWUP_PATTERN = /^🔔 (?:Tu ticket #(\d+)|Nuevo seguimiento en tu ticket #(\d+))/;
const teamsRecords = readAuditRecords(TEAMS_AUDIT_LOG_PATH, INCLUDE_ROTATED);
const notifications = new Map(); // requestId -> [{ timestamp, preview }]

for (const record of teamsRecords) {
  if (record.outcome !== 'reply_sent') continue;
  const preview = record.replyPreview || '';
  const match = preview.match(FOLLOWUP_PATTERN);
  if (!match) continue;
  const requestId = match[1] || match[2];
  if (!notifications.has(requestId)) notifications.set(requestId, []);
  notifications.get(requestId).push({ timestamp: record.timestamp, preview });
}

// 3. Cruce
const rows = Array.from(createdTickets.values()).map((ticket) => {
  const ticketNotifications = notifications.get(ticket.requestId) || [];
  return {
    requestId: ticket.requestId,
    createdAt: formatDate(ticket.timestamp),
    name: ticket.name,
    email: ticket.email,
    subject: truncateCell(ticket.subject, 50),
    category: ticket.category,
    notificationCount: ticketNotifications.length,
    lastNotifiedAt: ticketNotifications.length ? formatDate(ticketNotifications[ticketNotifications.length - 1].timestamp) : ''
  };
}).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

const visibleRows = ONLY_MISSING ? rows.filter((r) => r.notificationCount === 0) : rows;

const totalCreated = rows.length;
const totalNotified = rows.filter((r) => r.notificationCount > 0).length;
const coveragePct = totalCreated ? ((totalNotified / totalCreated) * 100).toFixed(1) : '0.0';

// 4. Salida
if (FORMAT === 'json') {
  writeOrPrint(JSON.stringify({
    summary: { totalCreated, totalNotified, totalMissing: totalCreated - totalNotified, coveragePct: Number(coveragePct) },
    rows: visibleRows
  }, null, 2));
} else if (FORMAT === 'md' || FORMAT === 'markdown') {
  writeOrPrint(renderMarkdown(visibleRows, { totalCreated, totalNotified, coveragePct }));
} else {
  writeOrPrint(renderTable(visibleRows, { totalCreated, totalNotified, coveragePct }));
}

// --- FUNCIONES AUXILIARES ---

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

function parseSinceBoundary(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    console.error(`--since inválido: "${value}"`);
    process.exit(1);
  }
  return d.getTime();
}

function parseUntilBoundary(value) {
  if (!value) return null;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  const d = new Date(isDateOnly ? `${value.trim()}T23:59:59.999` : value);
  if (Number.isNaN(d.getTime())) {
    console.error(`--until inválido: "${value}"`);
    process.exit(1);
  }
  return d.getTime();
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function truncateCell(value, maxLength) {
  const str = String(value ?? '');
  if (str.length <= maxLength) return str;
  return `${str.slice(0, Math.max(0, maxLength - 3))}...`;
}

function renderTable(rows, summary) {
  const header = `Cobertura de avisos de seguimiento: ${summary.totalNotified}/${summary.totalCreated} tickets creados por Sophia recibieron al menos un aviso (${summary.coveragePct}%).`;
  if (!rows.length) return `${header}\nNo hay tickets que cumplan los filtros indicados.`;

  const columns = [
    ['requestId', 'Ticket'],
    ['createdAt', 'Creado'],
    ['name', 'Solicitante'],
    ['email', 'Correo'],
    ['category', 'Categoría'],
    ['notificationCount', 'Avisos'],
    ['lastNotifiedAt', 'Último aviso']
  ];

  const widths = Object.fromEntries(columns.map(([key, label]) => [
    key,
    Math.max(label.length, ...rows.map((row) => String(row[key] ?? '').length))
  ]));

  const headerRow = columns.map(([key, label]) => label.padEnd(widths[key])).join('  ');
  const separator = columns.map(([key]) => '-'.repeat(widths[key])).join('  ');
  const body = rows.map((row) => columns.map(([key]) => String(row[key] ?? '').padEnd(widths[key])).join('  '));

  return [header, '', headerRow, separator, ...body].join('\n');
}

function renderMarkdown(rows, summary) {
  const lines = [
    `# Cobertura de avisos de seguimiento`,
    ``,
    `**${summary.totalNotified}/${summary.totalCreated}** tickets creados por Sophia recibieron al menos un aviso de avance (**${summary.coveragePct}%**).`,
    ``,
    `| Ticket | Creado | Solicitante | Correo | Categoría | Avisos | Último aviso |`,
    `| --- | --- | --- | --- | --- | --- | --- |`
  ];
  for (const row of rows) {
    lines.push(`| ${row.requestId} | ${row.createdAt} | ${row.name} | ${row.email} | ${row.category} | ${row.notificationCount} | ${row.lastNotifiedAt} |`);
  }
  return `${lines.join('\n')}\n`;
}

function writeOrPrint(content) {
  if (!OUTPUT) {
    console.log(content);
    return;
  }
  const outputPath = resolve(OUTPUT);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content);
  console.log(`Reporte generado con éxito en: ${outputPath}`);
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}
