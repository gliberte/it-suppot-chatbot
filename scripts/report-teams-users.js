import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

const LOG_PATH = resolve(getArgValue('--log-path') || process.env.TEAMS_AUDIT_LOG_PATH || 'teams-audit.log');
const FORMAT = getArgValue('--format') || 'table';
const OUTPUT = getArgValue('--output');
const SINCE = getArgValue('--since');
const SORT_BY = getArgValue('--sort') || 'messages'; // 'messages', 'name', 'lastSeen'

if (!existsSync(LOG_PATH)) {
  console.error(`No existe el archivo de auditoría de Teams: ${LOG_PATH}`);
  process.exit(1);
}

const records = readAuditRecords(LOG_PATH)
  .filter((record) => !SINCE || new Date(record.timestamp) >= new Date(SINCE));

const userMap = new Map();

for (const record of records) {
  const from = record.from || {};
  const userId = from.aadObjectId || from.id || from.name;
  if (!userId) continue;

  if (!userMap.has(userId)) {
    userMap.set(userId, {
      id: userId,
      name: from.name || record.user?.name || 'Desconocido',
      sdpRequesterId: record.user?.sdpRequesterId || '',
      messagesSent: 0,
      messagesReceived: 0,
      conversationTypes: new Set(),
      firstSeen: record.timestamp,
      lastSeen: record.timestamp
    });
  }

  const userData = userMap.get(userId);

  // Update SDP requester ID if found
  if (record.user?.sdpRequesterId && !userData.sdpRequesterId) {
    userData.sdpRequesterId = record.user.sdpRequesterId;
  }
  if (record.user?.name && userData.name === 'Desconocido') {
    userData.name = record.user.name;
  }

  // Update timestamps
  const recTime = new Date(record.timestamp).getTime();
  if (new Date(userData.firstSeen).getTime() > recTime) {
    userData.firstSeen = record.timestamp;
  }
  if (new Date(userData.lastSeen).getTime() < recTime) {
    userData.lastSeen = record.timestamp;
  }

  // Add conversation type
  if (record.conversationType) {
    userData.conversationTypes.add(record.conversationType);
  }

  // Count messages
  if (record.outcome === 'reply_sent') {
    userData.messagesReceived += 1;
  } else if (record.outcome === 'message_received' || record.outcome === 'user_not_mapped') {
    userData.messagesSent += 1;
  }
}

// Convert map to array and format
let rows = Array.from(userMap.values()).map((user) => ({
  name: user.name,
  sdpRequesterId: user.sdpRequesterId || '-',
  messagesSent: user.messagesSent,
  messagesReceived: user.messagesReceived,
  totalMessages: user.messagesSent + user.messagesReceived,
  channels: Array.from(user.conversationTypes).join(', ') || '-',
  firstSeen: formatDate(user.firstSeen),
  lastSeen: formatDate(user.lastSeen),
  firstSeenRaw: user.firstSeen,
  lastSeenRaw: user.lastSeen
}));

// Sorting logic
if (SORT_BY === 'name') {
  rows.sort((a, b) => a.name.localeCompare(b.name));
} else if (SORT_BY === 'lastSeen') {
  rows.sort((a, b) => new Date(b.lastSeenRaw).getTime() - new Date(a.lastSeenRaw).getTime());
} else {
  // default: sort by total messages descending
  rows.sort((a, b) => b.totalMessages - a.totalMessages);
}

// Format output
if (FORMAT === 'json') {
  writeOrPrint(JSON.stringify(rows, null, 2));
} else if (FORMAT === 'md' || FORMAT === 'markdown') {
  writeOrPrint(renderMarkdown(rows));
} else if (FORMAT === 'csv') {
  writeOrPrint(renderCsv(rows));
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

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  
  // Format as YYYY-MM-DD HH:MM
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderTable(rows) {
  if (!rows.length) return 'No hay registros de uso en teams-audit.log con los filtros indicados.';

  const columns = [
    ['name', 'Nombre Usuario'],
    ['sdpRequesterId', 'ID SDP'],
    ['messagesSent', 'Msg Enviados'],
    ['messagesReceived', 'Msg Recibidos'],
    ['totalMessages', 'Total Interacciones'],
    ['channels', 'Canales/Chats'],
    ['lastSeen', 'Último Uso']
  ];

  return renderFixedTable(rows, columns);
}

function renderMarkdown(rows) {
  if (!rows.length) return 'No hay registros de uso en teams-audit.log con los filtros indicados.\n';

  const header = [
    'Nombre Usuario',
    'ID SDP',
    'Msg Enviados',
    'Msg Recibidos',
    'Total Interacciones',
    'Canales/Chats',
    'Último Uso'
  ];
  const lines = [
    `# Reporte de Uso de Sophia en Teams`,
    `Generado el: ${formatDate(new Date().toISOString())}`,
    ``,
    `| ${header.join(' |')} |`,
    `| ${header.map(() => '---').join(' | ')} |`
  ];

  for (const row of rows) {
    lines.push(`| ${[
      row.name,
      row.sdpRequesterId,
      row.messagesSent,
      row.messagesReceived,
      row.totalMessages,
      row.channels,
      row.lastSeen
    ].map(escapeMarkdownCell).join(' | ')} |`);
  }

  return `${lines.join('\n')}\n`;
}

function renderCsv(rows) {
  if (!rows.length) return 'Nombre Usuario,ID SDP,Msg Enviados,Msg Recibidos,Total Interacciones,Canales/Chats,Ultimo Uso\n';

  const header = ['Nombre Usuario', 'ID SDP', 'Msg Enviados', 'Msg Recibidos', 'Total Interacciones', 'Canales/Chats', 'Ultimo Uso'];
  const lines = [header.join(',')];

  for (const row of rows) {
    const fields = [
      row.name,
      row.sdpRequesterId,
      row.messagesSent,
      row.messagesReceived,
      row.totalMessages,
      row.channels,
      row.lastSeen
    ].map((val) => {
      const str = String(val ?? '').replace(/"/g, '""');
      return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
    });
    lines.push(fields.join(','));
  }

  return `${lines.join('\n')}\n`;
}

function renderFixedTable(rows, columns) {
  const prepared = rows.map((row) => {
    const entry = {};
    for (const [key] of columns) {
      entry[key] = truncateCell(String(row[key] ?? ''), key === 'name' ? 30 : 20);
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
