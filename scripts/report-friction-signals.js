// Detecta señales de fricción/frustración en conversaciones reales de Teams, para encontrar
// oportunidades de mejora.
//
// Se probó primero un enfoque de palabras clave ("no funciona", "urgente", "molesto", etc.) contra
// datos reales de producción y resultó demasiado ruidoso: en un contexto de soporte IT, frases como
// "no funciona" describen el problema técnico normal, no necesariamente frustración -- y "urgente"
// apareció en el texto de un autorespondedor de vacaciones. Un umbral simple de "3+ mensajes en
// pocos minutos" también resultó demasiado amplio: casi cualquier conversación normal de creación
// de ticket produce eso.
//
// En su lugar, se usan tres señales de COMPORTAMIENTO, verificadas contra datos reales antes de
// construir esto -- mucho menos ambiguas que el texto:
//
// 1. Mensaje idéntico repetido consecutivamente por la misma persona en la misma conversación
//    (incluye el caso más claro: el mismo __sophia_confirm:<id> mandado dos veces seguidas --
//    la persona le dio clic a Confirmar, no vio reacción, y volvió a darle clic).
// 2. Cancelación explícita (__sophia_cancel:, o frases inequívocas de "cancela esto").
// 3. Confirmación mostrada (confirmation_required) que nunca se resolvió (ni confirmed_success ni
//    confirmed_error) dentro de una ventana razonable -- la persona se quedó a medias.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { gunzipSync } from 'zlib';

const ROTATED_LOOKBACK = 30; // margen sobre el rotate 14 de deploy/logrotate/sophia
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000; // 5 min: mismo mensaje repetido en este lapso
const ABANDONED_CONFIRMATION_WINDOW_MS = 30 * 60 * 1000; // 30 min sin resolverse = abandonada

const TEAMS_AUDIT_LOG_PATH = resolve(getArgValue('--teams-audit-log-path') || process.env.TEAMS_AUDIT_LOG_PATH || 'teams-audit.log');
const AUDIT_LOG_PATH = resolve(getArgValue('--audit-log-path') || process.env.AUDIT_LOG_PATH || 'audit.log');
const SINCE = getArgValue('--since');
const UNTIL = getArgValue('--until');
const FORMAT = getArgValue('--format') || 'text';
const OUTPUT = getArgValue('--output');
const INCLUDE_ROTATED = !hasFlag('--no-rotated');

if (!existsSync(TEAMS_AUDIT_LOG_PATH)) {
  console.error(`No existe el archivo de auditoría de Teams: ${TEAMS_AUDIT_LOG_PATH}`);
  process.exit(1);
}
if (!existsSync(AUDIT_LOG_PATH)) {
  console.error(`No existe el archivo de auditoría: ${AUDIT_LOG_PATH}`);
  process.exit(1);
}

const sinceBoundary = SINCE ? parseBoundary(SINCE, false) : null;
const untilBoundary = UNTIL ? parseBoundary(UNTIL, true) : null;

const CANCEL_PHRASES = [
  'cancelalo', 'cancélalo', 'cancelala', 'cancélala', 'cancela esto', 'cancela eso',
  'cancela la solicitud', 'cancela el ticket', 'no lo hagas', 'mejor no', 'olvidalo', 'olvídalo'
];

// 1. Cargar mensajes de Teams dentro del rango pedido
const teamsRecords = readAuditRecords(TEAMS_AUDIT_LOG_PATH, INCLUDE_ROTATED)
  .filter((r) => r.outcome === 'message_received')
  .filter((r) => withinRange(r.timestamp))
  .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

// 2. Agrupar por conversación para detectar repeticiones y cancelaciones
const byConversation = new Map();
for (const r of teamsRecords) {
  const conv = r.conversationId;
  if (!conv) continue;
  if (!byConversation.has(conv)) byConversation.set(conv, []);
  byConversation.get(conv).push(r);
}

const duplicateSignals = [];
const cancelSignals = [];

for (const [conv, msgs] of byConversation.entries()) {
  for (let i = 1; i < msgs.length; i += 1) {
    const prev = msgs[i - 1];
    const curr = msgs[i];
    const prevText = (prev.messagePreview || '').trim();
    const currText = (curr.messagePreview || '').trim();
    const gapMs = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();

    if (prevText && currText && prevText === currText && gapMs <= DUPLICATE_WINDOW_MS) {
      duplicateSignals.push({
        conversationId: conv,
        name: curr.from?.name || curr.user?.name || 'Desconocido',
        timestamp: curr.timestamp,
        text: currText,
        gapSeconds: Math.round(gapMs / 1000),
        isConfirmClick: /^__sophia_confirm:/.test(currText)
      });
    }

    if (isCancelSignal(currText)) {
      cancelSignals.push({
        conversationId: conv,
        name: curr.from?.name || curr.user?.name || 'Desconocido',
        timestamp: curr.timestamp,
        text: currText
      });
    }
  }
  // el primer mensaje de cada conversación también puede ser una cancelación
  if (msgs.length && isCancelSignal((msgs[0].messagePreview || '').trim())) {
    cancelSignals.push({
      conversationId: conv,
      name: msgs[0].from?.name || msgs[0].user?.name || 'Desconocido',
      timestamp: msgs[0].timestamp,
      text: (msgs[0].messagePreview || '').trim()
    });
  }
}

// 3. Confirmaciones abandonadas: confirmation_required de un usuario sin confirmed_success/
// confirmed_error del MISMO usuario dentro de la ventana (o antes de que llegue una
// confirmation_required más nueva del mismo usuario, lo que ocurra primero).
const auditRecords = readAuditRecords(AUDIT_LOG_PATH, INCLUDE_ROTATED)
  .filter((r) => withinRange(r.timestamp))
  .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

const byUser = new Map();
for (const r of auditRecords) {
  const key = r.user?.email || r.user?.name || 'desconocido';
  if (!byUser.has(key)) byUser.set(key, []);
  byUser.get(key).push(r);
}

const abandonedConfirmations = [];
for (const [userKey, records] of byUser.entries()) {
  for (let i = 0; i < records.length; i += 1) {
    const r = records[i];
    if (r.outcome !== 'confirmation_required') continue;
    const startTime = new Date(r.timestamp).getTime();

    let resolved = false;
    for (let j = i + 1; j < records.length; j += 1) {
      const next = records[j];
      const nextTime = new Date(next.timestamp).getTime();
      if (nextTime - startTime > ABANDONED_CONFIRMATION_WINDOW_MS) break;
      if (next.outcome === 'confirmed_success' || next.outcome === 'confirmed_error') {
        resolved = true;
        break;
      }
      if (next.outcome === 'confirmation_required') break; // superada por un intento más nuevo
    }

    if (!resolved) {
      abandonedConfirmations.push({
        user: records[0].user?.name || userKey,
        timestamp: r.timestamp,
        toolName: r.toolName,
        subject: r.args?.subject || r.args?.request_id || ''
      });
    }
  }
}

// 4. Salida
const summary = {
  generatedAt: new Date().toISOString(),
  since: SINCE || null,
  until: UNTIL || null,
  totalMessages: teamsRecords.length,
  duplicateMessages: duplicateSignals.length,
  duplicateConfirmClicks: duplicateSignals.filter((s) => s.isConfirmClick).length,
  explicitCancellations: cancelSignals.length,
  abandonedConfirmations: abandonedConfirmations.length
};

if (FORMAT === 'json') {
  writeOrPrint(JSON.stringify({ summary, duplicateSignals, cancelSignals, abandonedConfirmations }, null, 2));
} else if (FORMAT === 'md' || FORMAT === 'markdown') {
  writeOrPrint(renderMarkdown(summary, duplicateSignals, cancelSignals, abandonedConfirmations));
} else {
  writeOrPrint(renderText(summary, duplicateSignals, cancelSignals, abandonedConfirmations));
}

// --- FUNCIONES AUXILIARES ---

function isCancelSignal(text) {
  if (!text) return false;
  if (/^__sophia_cancel:/.test(text)) return true;
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return CANCEL_PHRASES.some((phrase) => {
    const normalizedPhrase = phrase.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return normalized.includes(normalizedPhrase);
  });
}

function withinRange(timestamp) {
  const t = new Date(timestamp || 0).getTime();
  if (sinceBoundary !== null && t < sinceBoundary) return false;
  if (untilBoundary !== null && t > untilBoundary) return false;
  return true;
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

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderText(summary, duplicates, cancels, abandoned) {
  const lines = [];
  lines.push('Señales de fricción en conversaciones de Teams');
  lines.push('================================================');
  lines.push(`Generado: ${summary.generatedAt}`);
  lines.push(`Rango: ${summary.since || 'inicio'} -> ${summary.until || 'ahora'}`);
  lines.push('');
  lines.push('Resumen');
  lines.push('-------');
  lines.push(`Mensajes totales analizados: ${summary.totalMessages}`);
  lines.push(`Mensajes duplicados consecutivos: ${summary.duplicateMessages} (de los cuales ${summary.duplicateConfirmClicks} son doble clic en Confirmar)`);
  lines.push(`Cancelaciones explícitas: ${summary.explicitCancellations}`);
  lines.push(`Confirmaciones abandonadas (mostradas, nunca resueltas): ${summary.abandonedConfirmations}`);
  lines.push('');

  lines.push('Doble clic en Confirmar (señal más fuerte -- sugiere que no hay feedback visible tras confirmar)');
  lines.push('----------------------------------------------------------------------------------------------');
  const confirmDupes = duplicates.filter((d) => d.isConfirmClick);
  if (!confirmDupes.length) {
    lines.push('(ninguno en este rango)');
  } else {
    for (const d of confirmDupes) {
      lines.push(`- ${formatDate(d.timestamp)} ${d.name} (${d.gapSeconds}s después) conv=${d.conversationId}`);
    }
  }
  lines.push('');

  lines.push('Mensajes repetidos (no confirmación)');
  lines.push('-------------------------------------');
  const otherDupes = duplicates.filter((d) => !d.isConfirmClick);
  if (!otherDupes.length) {
    lines.push('(ninguno en este rango)');
  } else {
    for (const d of otherDupes.slice(0, 20)) {
      lines.push(`- ${formatDate(d.timestamp)} ${d.name}: "${truncate(d.text, 80)}"`);
    }
  }
  lines.push('');

  lines.push('Cancelaciones explícitas');
  lines.push('-------------------------');
  if (!cancels.length) {
    lines.push('(ninguna en este rango)');
  } else {
    for (const c of cancels.slice(0, 20)) {
      lines.push(`- ${formatDate(c.timestamp)} ${c.name}: "${truncate(c.text, 80)}"`);
    }
  }
  lines.push('');

  lines.push('Confirmaciones abandonadas');
  lines.push('---------------------------');
  if (!abandoned.length) {
    lines.push('(ninguna en este rango)');
  } else {
    for (const a of abandoned.slice(0, 20)) {
      lines.push(`- ${formatDate(a.timestamp)} ${a.user} | ${a.toolName} | ${truncate(String(a.subject), 60)}`);
    }
  }
  lines.push('');
  lines.push('Para ver el contexto completo de cualquiera de estos casos:');
  lines.push('  npm run report:transcript -- --user "<nombre>" --since <fecha> --until <fecha>');

  return lines.join('\n');
}

function renderMarkdown(summary, duplicates, cancels, abandoned) {
  const lines = [
    '# Señales de fricción en conversaciones de Teams',
    '',
    `Generado: ${summary.generatedAt}`,
    `Rango: ${summary.since || 'inicio'} -> ${summary.until || 'ahora'}`,
    '',
    '## Resumen',
    '',
    `- Mensajes totales analizados: ${summary.totalMessages}`,
    `- Mensajes duplicados consecutivos: ${summary.duplicateMessages} (${summary.duplicateConfirmClicks} son doble clic en Confirmar)`,
    `- Cancelaciones explícitas: ${summary.explicitCancellations}`,
    `- Confirmaciones abandonadas: ${summary.abandonedConfirmations}`,
    ''
  ];
  return `${lines.join('\n')}\n`;
}

function truncate(text, maxLength) {
  const str = String(text ?? '');
  if (str.length <= maxLength) return str;
  return `${str.slice(0, Math.max(0, maxLength - 3))}...`;
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

function hasFlag(name) {
  return process.argv.includes(name);
}
