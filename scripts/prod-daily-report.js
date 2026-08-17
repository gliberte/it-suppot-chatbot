import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const REPORT_DATE = getArgValue('--date') || new Date().toISOString().slice(0, 10);
const OUTPUT_DIR = resolve(process.env.SOPHIA_DAILY_REPORT_DIR || 'reports/daily');
const OUTPUT_PATH = resolve(getArgValue('--output') || `${OUTPUT_DIR}/sophia-daily-${REPORT_DATE}.md`);
const SINCE = new Date(`${REPORT_DATE}T00:00:00.000Z`).getTime();
const UNTIL = new Date(`${REPORT_DATE}T23:59:59.999Z`).getTime();

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function inReportDate(event) {
  const time = new Date(event.timestamp).getTime();
  return Number.isFinite(time) && time >= SINCE && time <= UNTIL;
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item) || 'sin_dato';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function topEntries(counts, limit = 8) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function formatTable(headers, rows) {
  if (!rows.length) return '_Sin datos._';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`)
  ].join('\n');
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function truncate(value, max = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

function getMonitorState() {
  const path = 'reports/prod-monitor-state.json';
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function getKnowledgeCandidates() {
  const path = resolve(process.env.KNOWLEDGE_CANDIDATES_PATH || 'data/knowledge-candidates.json');
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(data.candidates) ? data.candidates : [];
  } catch {
    return [];
  }
}

function buildReport() {
  const teamsEvents = readJsonLines('teams-audit.log').filter(inReportDate);
  const toolEvents = readJsonLines('audit.log').filter(inReportDate);
  const alertEvents = readJsonLines('reports/prod-monitor-alerts.log').filter(inReportDate);
  const monitorState = getMonitorState();

  const messages = teamsEvents.filter((event) => event.outcome === 'message_received');
  const replies = teamsEvents.filter((event) => event.outcome === 'reply_sent');
  const cards = teamsEvents.filter((event) => event.format === 'adaptive_card');
  const teamsErrors = teamsEvents.filter((event) => String(event.outcome || '').includes('error'));

  const toolSuccess = toolEvents.filter((event) => ['success', 'confirmed_success'].includes(event.outcome));
  const toolErrors = toolEvents.filter((event) => String(event.outcome || '').includes('error') || event.error);
  const confirmations = toolEvents.filter((event) => event.outcome === 'confirmation_required');
  const confirmedSuccess = toolEvents.filter((event) => event.outcome === 'confirmed_success');
  const expired = toolEvents.filter((event) => event.outcome === 'confirmation_expired');
  const cancelled = toolEvents.filter((event) => event.outcome === 'confirmation_cancelled');
  const createdTickets = toolEvents.filter((event) => event.toolName === 'sdp_create_request' && ['success', 'confirmed_success'].includes(event.outcome));

  const topTools = topEntries(countBy(toolEvents, (event) => event.toolName));
  const topUsers = topEntries(countBy(messages, (event) => event.user?.name || event.from?.name), 10);
  const topOutcomes = topEntries(countBy(toolEvents, (event) => event.outcome), 10);
  const topCategories = topEntries(countBy(
    toolEvents.filter((event) => event.toolName === 'sdp_create_request'),
    (event) => [event.args?.category, event.args?.subcategory].filter(Boolean).join(' / ')
  ), 10);

  const latestErrors = toolErrors.slice(-8).map((event) => [
    event.timestamp,
    event.toolName,
    event.user?.name || '',
    truncate(event.error?.message || event.outcome || 'error', 100)
  ]);

  const latestAlerts = alertEvents.slice(-8).map((event) => [
    event.timestamp,
    event.status,
    event.transition,
    event.problemCount,
    truncate((event.problems || []).join(' | '), 140)
  ]);

  const knowledgeCandidates = getKnowledgeCandidates();
  const pendingCandidates = knowledgeCandidates.filter((candidate) => candidate.status === 'pending_review');
  const approvedCandidates = knowledgeCandidates.filter((candidate) => candidate.status === 'approved');
  const newCandidatesToday = knowledgeCandidates.filter((candidate) => inReportDate({ timestamp: candidate.createdAt }));
  const pendingRows = pendingCandidates
    .slice(-15)
    .map((candidate) => [candidate.id, candidate.type, truncate(candidate.title, 90)]);

  const statusLine = monitorState
    ? `${monitorState.problemCount ? 'Con observaciones' : 'Sin observaciones'} (${monitorState.problemCount || 0} problema(s) en último monitor, actualizado ${monitorState.updatedAt || 'n/a'})`
    : 'Sin estado de monitor disponible';

  return [
    `# Reporte Diario Sophia - ${REPORT_DATE}`,
    '',
    `Generado: ${new Date().toISOString()}`,
    '',
    '## Resumen Ejecutivo',
    '',
    `- Último estado monitor disponible: ${statusLine}`,
    `- Mensajes Teams recibidos: ${messages.length}`,
    `- Respuestas enviadas: ${replies.length}`,
    `- Tarjetas enviadas: ${cards.length}`,
    `- Errores Teams registrados: ${teamsErrors.length}`,
    `- Herramientas ejecutadas/auditadas: ${toolEvents.length}`,
    `- Ejecuciones exitosas: ${toolSuccess.length}`,
    `- Errores de herramientas/SDP: ${toolErrors.length}`,
    `- Confirmaciones requeridas: ${confirmations.length}`,
    `- Confirmaciones exitosas: ${confirmedSuccess.length}`,
    `- Confirmaciones expiradas: ${expired.length}`,
    `- Confirmaciones canceladas: ${cancelled.length}`,
    `- Tickets creados por Sophia: ${createdTickets.length}`,
    `- Cambios de alerta del monitor: ${alertEvents.length}`,
    `- Candidatos de conocimiento nuevos hoy: ${newCandidatesToday.length}`,
    `- Candidatos de conocimiento pendientes de revisión: ${pendingCandidates.length}${approvedCandidates.length ? ` (+${approvedCandidates.length} aprobado(s) sin aplicar)` : ''}`,
    '',
    '## Herramientas Más Usadas',
    '',
    formatTable(['Herramienta', 'Cantidad'], topTools),
    '',
    '## Usuarios Con Actividad Teams',
    '',
    formatTable(['Usuario', 'Mensajes'], topUsers),
    '',
    '## Resultados De Herramientas',
    '',
    formatTable(['Resultado', 'Cantidad'], topOutcomes),
    '',
    '## Clasificación De Tickets Preparados',
    '',
    formatTable(['Categoría / Subcategoría', 'Cantidad'], topCategories),
    '',
    '## Últimos Errores De Herramientas',
    '',
    formatTable(['Fecha', 'Herramienta', 'Usuario', 'Error'], latestErrors),
    '',
    '## Cambios De Alerta Del Monitor',
    '',
    formatTable(['Fecha', 'Estado', 'Transición', 'Problemas', 'Detalle'], latestAlerts),
    '',
    '## Candidatos De Conocimiento',
    '',
    `Nuevos hoy: ${newCandidatesToday.length}. Pendientes de revisión: ${pendingCandidates.length}. Aprobados sin aplicar: ${approvedCandidates.length}.`,
    '',
    formatTable(['ID', 'Tipo', 'Título'], pendingRows),
    '',
    ...(pendingCandidates.length > 0 ? [
      'Revisar con:',
      '',
      '```bash',
      'npm run knowledge:review -- --limit 10',
      '```',
      ''
    ] : [])
  ].join('\n');
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, buildReport(), 'utf8');
console.log(`Reporte diario generado: ${OUTPUT_PATH}`);
