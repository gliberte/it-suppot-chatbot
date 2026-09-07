import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { gunzipSync } from 'zlib';

// logrotate (deploy/logrotate/sophia) rota teams-audit.log a diario, guarda 14 días y comprime
// todo menos el de ayer (daily + rotate 14 + compress + delaycompress): teams-audit.log (hoy),
// teams-audit.log.1 (ayer, sin comprimir), teams-audit.log.2.gz .. .14.gz (más atrás). Por defecto
// esta herramienta junta el activo + todos los rotados que existan, para que --since/--until
// puedan cubrir cualquier fecha dentro de esos 14 días sin tener que descomprimir nada a mano.
const ROTATED_LOOKBACK = 30; // margen sobre el rotate 14 configurado, por si cambia

const LOG_PATH = resolve(getArgValue('--log-path') || process.env.TEAMS_AUDIT_LOG_PATH || 'teams-audit.log');
const USER_QUERY = getArgValue('--user');
const OUTPUT = getArgValue('--output');
const FORMAT = getArgValue('--format') || 'text'; // 'text', 'json'
const SINCE = getArgValue('--since');
const UNTIL = getArgValue('--until');
const INCLUDE_ROTATED = !process.argv.includes('--no-rotated');

if (!existsSync(LOG_PATH)) {
  console.error(`No existe el archivo de auditoría de Teams: ${LOG_PATH}`);
  process.exit(1);
}

if (!USER_QUERY) {
  console.log('Uso: npm run report:transcript -- --user "NombreUsuario" [opciones]');
  console.log('\nOpciones:');
  console.log('  --user "<query>"    Nombre, correo o ID de SDP a buscar (Requerido)');
  console.log('  --since <fecha>     Solo mensajes desde esta fecha/hora (ISO, ej. 2026-08-31)');
  console.log('  --until <fecha>     Solo mensajes hasta esta fecha/hora (ISO, ej. 2026-09-06)');
  console.log('  --log-path <path>   Ruta al archivo teams-audit.log activo (Opcional)');
  console.log('  --no-rotated        No incluir los archivos rotados por logrotate (solo el activo)');
  console.log('  --output <path>     Archivo de destino para guardar el reporte (Opcional)');
  console.log('  --format <format>   Formato de salida: text, json (Por defecto: text)');
  console.log('\nPor defecto se leen el log activo y todos sus rotados (.1, .2.gz, ...) para cubrir');
  console.log('los 14 días de retención configurados en deploy/logrotate/sophia.');
  process.exit(0);
}

const sinceBoundary = parseSinceBoundary(SINCE);
const untilBoundary = parseUntilBoundary(UNTIL);

// 1. Cargar todos los registros de todos los archivos (activo + rotados), ordenados por tiempo
const allRecords = readAuditRecords(LOG_PATH, INCLUDE_ROTATED)
  .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

// 2. Identificar el usuario y sus conversationIds (sobre TODO el historial disponible, sin
// filtrar por fecha todavía -- así encontramos el conversationId correcto aunque el mensaje que
// identifica al usuario haya quedado fuera del rango --since/--until pedido).
const queryLower = USER_QUERY.toLowerCase().trim();
const matchedConversationIds = new Set();
const matchedUserNames = new Set();

for (const record of allRecords) {
  const from = record.from || {};
  const user = record.user || {};

  const fromName = String(from.name || '').toLowerCase();
  const userEmail = String(user.email || '').toLowerCase();
  const sdpId = String(user.sdpRequesterId || '').toLowerCase();
  const aadObjectId = String(from.aadObjectId || '').toLowerCase();

  const isMatch = fromName.includes(queryLower) ||
                  userEmail.includes(queryLower) ||
                  sdpId === queryLower ||
                  aadObjectId === queryLower;

  if (isMatch && record.conversationId) {
    matchedConversationIds.add(record.conversationId);
    if (from.name) matchedUserNames.add(from.name);
    if (user.name) matchedUserNames.add(user.name);
  }
}

if (matchedConversationIds.size === 0) {
  console.log(`No se encontró ninguna conversación asociada al usuario: "${USER_QUERY}"`);
  process.exit(0);
}

// 3. Agrupar diálogos por conversationId, aplicando --since/--until a qué mensajes se muestran
const dialogueByConv = new Map();

for (const record of allRecords) {
  if (!record.conversationId || !matchedConversationIds.has(record.conversationId)) {
    continue;
  }

  const recordTime = new Date(record.timestamp).getTime();
  if (sinceBoundary !== null && recordTime < sinceBoundary) continue;
  if (untilBoundary !== null && recordTime > untilBoundary) continue;

  if (!dialogueByConv.has(record.conversationId)) {
    dialogueByConv.set(record.conversationId, {
      id: record.conversationId,
      type: record.conversationType || 'personal',
      messages: []
    });
  }

  const conv = dialogueByConv.get(record.conversationId);

  // Extraer mensaje e interlocutor
  let sender = 'Sistema';
  let messageText = '';
  let isSophia = false;

  if (record.outcome === 'reply_sent') {
    sender = 'Sophia';
    isSophia = true;
    messageText = record.replyPreview || record.cardPreview || '[Tarjeta Adaptativa o Respuesta Especial]';
  } else {
    // message_received, user_not_mapped, etc.
    sender = record.from?.name || record.user?.name || 'Usuario';
    messageText = record.messagePreview || '[Mensaje vacío o Archivo adjunto]';
  }

  conv.messages.push({
    timestamp: record.timestamp,
    sender,
    text: messageText,
    isSophia,
    outcome: record.outcome
  });
}

if (dialogueByConv.size === 0) {
  const rangeDescription = describeRange(SINCE, UNTIL);
  console.log(`Se encontró a "${Array.from(matchedUserNames).join(', ') || USER_QUERY}", pero no tiene mensajes${rangeDescription}.`);
  process.exit(0);
}

// 4. Formatear la salida
let outputContent = '';

if (FORMAT === 'json') {
  const result = Array.from(dialogueByConv.values()).map(conv => ({
    conversationId: conv.id,
    type: conv.type,
    messages: conv.messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  }));
  outputContent = JSON.stringify(result, null, 2);
} else {
  // Formato texto amigable
  const lines = [];
  lines.push('========================================================================');
  lines.push(` TRANSCRIPCIÓN DE CONVERSACIONES DE TEAMS - SOPHIA`);
  lines.push(` Búsqueda: "${USER_QUERY}"`);
  lines.push(` Usuarios Encontrados: ${Array.from(matchedUserNames).join(', ') || 'N/A'}`);
  lines.push(` Rango de fechas: ${describeRange(SINCE, UNTIL) || ' todo el historial disponible'}`);
  lines.push(` Total de Chats/Canales Encontrados: ${dialogueByConv.size}`);
  lines.push('========================================================================\n');

  let convIndex = 1;
  for (const [convId, conv] of dialogueByConv.entries()) {
    lines.push(`------------------------------------------------------------------------`);
    lines.push(` CHAT #${convIndex} (Tipo: ${conv.type.toUpperCase()})`);
    lines.push(` ID Conversación: ${convId}`);
    lines.push(`------------------------------------------------------------------------`);

    // Ordenar cronológicamente
    const sortedMessages = conv.messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    for (const msg of sortedMessages) {
      const timeStr = formatDate(msg.timestamp);
      const icon = msg.isSophia ? '🤖 Sophia' : `👤 ${msg.sender}`;
      lines.push(`[${timeStr}] ${icon}: ${msg.text}`);
    }
    lines.push('');
    convIndex++;
  }

  outputContent = lines.join('\n');
}

// 5. Escribir o Imprimir
if (OUTPUT) {
  const outputPath = resolve(OUTPUT);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, outputContent, 'utf8');
  console.log(`Transcripción de conversaciones guardada con éxito en: ${outputPath}`);
} else {
  console.log(outputContent);
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
        // línea corrupta o parcial (ej. escritura interrumpida) -- se ignora
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
  // Una fecha "pelada" (sin hora) debe incluir el día completo, no cortar a medianoche.
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  const d = new Date(isDateOnly ? `${value.trim()}T23:59:59.999` : value);
  if (Number.isNaN(d.getTime())) {
    console.error(`--until inválido: "${value}"`);
    process.exit(1);
  }
  return d.getTime();
}

function describeRange(since, until) {
  if (!since && !until) return '';
  if (since && until) return ` entre ${since} y ${until}`;
  if (since) return ` desde ${since}`;
  return ` hasta ${until}`;
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;

  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}
