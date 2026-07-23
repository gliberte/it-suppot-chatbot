import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

const LOG_PATH = resolve(getArgValue('--log-path') || process.env.TEAMS_AUDIT_LOG_PATH || 'teams-audit.log');
const USER_QUERY = getArgValue('--user');
const OUTPUT = getArgValue('--output');
const FORMAT = getArgValue('--format') || 'text'; // 'text', 'json'

if (!existsSync(LOG_PATH)) {
  console.error(`No existe el archivo de auditoría de Teams: ${LOG_PATH}`);
  process.exit(1);
}

if (!USER_QUERY) {
  console.log('Uso: npm run get:transcript -- --user "NombreUsuario" [opciones]');
  console.log('\nOpciones:');
  console.log('  --user "<query>"    Nombre, correo o ID de SDP a buscar (Requerido)');
  console.log('  --log-path <path>   Ruta al archivo teams-audit.log (Opcional)');
  console.log('  --output <path>     Archivo de destino para guardar el reporte (Opcional)');
  console.log('  --format <format>   Formato de salida: text, json (Por defecto: text)');
  process.exit(0);
}

// 1. Cargar todos los registros ordenados por tiempo
const allRecords = readAuditRecords(LOG_PATH);

// 2. Identificar el usuario y sus conversationIds
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

// 3. Agrupar diálogos por conversationId
const dialogueByConv = new Map();

for (const record of allRecords) {
  if (!record.conversationId || !matchedConversationIds.has(record.conversationId)) {
    continue;
  }

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
  lines.push(` Total de Chats/Canales Encontrados: ${matchedConversationIds.size}`);
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

function readAuditRecords(logPath) {
  try {
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
  } catch (error) {
    console.error(`Error leyendo el archivo de auditoría: ${error.message}`);
    process.exit(1);
  }
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
