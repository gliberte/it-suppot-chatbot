// Ingesta tickets y MCI ya cerrados/resueltos de ServiceDesk Plus al mismo índice RAG que usa
// Sophia para responder (data/rag-index.json, leído por rag.js / searchKnowledge). Hasta ahora ese
// índice solo tenía artículos de conocimiento curados a mano en knowledge/ (ver
// scripts/ingest-knowledge.js) -- este script agrega, además, casos REALES ya resueltos, para que
// Sophia pueda razonar con "esto se parece a un caso ya resuelto, se hizo X" en vez de solo
// artículos genéricos.
//
// No usa la base de datos de SDP (evaluado y descartado: no soportado, esquema no documentado,
// riesgo de romperse con un parche) -- toda la información sale de la misma API REST que ya usa
// sdp-mcp-server, exactamente igual que como Sophia la consulta en producción.
//
// Reutiliza las funciones puras de redacción/estado que ya usa Sophia para compartir una versión
// sanitizada de un ticket ajeno (lib/redaction.js: createSanitizedKnowledgeResponse) -- mismo
// criterio de qué es seguro compartir, en vez de inventar una redacción nueva para este caso.
//
// Es incremental por diseño: cachea cada fragmento por request_id + last_updated_time, así que una
// corrida posterior solo vuelve a pedir detalle y a generar embedding para los tickets que
// cambiaron desde la última vez -- el resto se reutiliza tal cual del índice existente. Los
// fragmentos de conocimiento curado (knowledge/*.md) no se tocan.
//
// Uso:
//   node scripts/ingest-ticket-history.js [--since 2026-08-01] [--max-pages 60]
//                                          [--page-size 50] [--force] [--dry-run]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';
import { getDisplayName, isMciRequestData, getMciLeaderValue } from '../lib/authz.js';
import { isResolvedKnowledgeStatus, getResolutionText, cleanKnowledgeText, redactKnowledgePeople } from '../lib/redaction.js';

const SDP_URL = process.env.SDP_URL;
const SDP_API_KEY = process.env.SDP_API_KEY;
const INDEX_PATH = resolve(process.env.RAG_INDEX_PATH || 'data/rag-index.json');
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const EMBEDDING_RETRIES = Number(process.env.RAG_EMBEDDING_RETRIES || 4);
const EMBEDDING_RETRY_DELAY_MS = Number(process.env.RAG_EMBEDDING_RETRY_DELAY_MS || 2500);
const CHUNK_PREFIX = 'historial-';

const PAGE_SIZE = Number(getArgValue('--page-size') || 50);
const MAX_PAGES = Number(getArgValue('--max-pages') || process.env.TICKET_HISTORY_MAX_PAGES || 60);
const SINCE = getArgValue('--since'); // fecha ISO, ej. 2026-08-01 -- solo tickets actualizados desde entonces
const FORCE = hasFlag('--force'); // re-genera el embedding aunque last_updated_time no haya cambiado
const DRY_RUN = hasFlag('--dry-run');

if (!SDP_API_KEY || !SDP_URL) {
  console.error('Falta SDP_URL/SDP_API_KEY en el entorno.');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error('Falta GEMINI_API_KEY para generar embeddings.');
  process.exit(1);
}

const sdpClient = axios.create({
  baseURL: SDP_URL,
  headers: {
    authtoken: SDP_API_KEY,
    Accept: 'application/vnd.manageengine.sdp.v3+json'
  }
});
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

main().catch((error) => {
  console.error('Error ejecutando ingest-ticket-history:', error);
  process.exit(1);
});

async function main() {
  const existingIndex = loadIndex(INDEX_PATH);
  const keepChunks = (existingIndex.chunks || []).filter((chunk) => !chunk.id?.startsWith(CHUNK_PREFIX));
  const cachedByRequestId = new Map();
  for (const chunk of existingIndex.chunks || []) {
    if (chunk.id?.startsWith(CHUNK_PREFIX) && chunk.requestId) cachedByRequestId.set(String(chunk.requestId), chunk);
  }

  const candidates = await listResolvedCandidates();
  console.log(`Candidatos cerrados/resueltos encontrados: ${candidates.length}`);

  const newChunks = [];
  let embedded = 0;
  let reused = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const requestId = String(candidate.id);
    const lastUpdatedTime = candidate.last_updated_time?.value || '';
    const cached = cachedByRequestId.get(requestId);

    if (cached && !FORCE && String(cached.lastUpdatedTime || '') === String(lastUpdatedTime)) {
      newChunks.push(cached);
      reused += 1;
      continue;
    }

    let detail;
    try {
      const response = await sdpClient.get(`/requests/${requestId}`);
      detail = response.data?.request;
    } catch (error) {
      console.warn(`No se pudo leer el detalle del ticket #${requestId}: ${error.message}`);
      skipped += 1;
      continue;
    }

    const chunk = buildChunkFromRequest(detail, lastUpdatedTime);
    if (!chunk) {
      skipped += 1;
      continue;
    }

    if (DRY_RUN) {
      console.log(`[dry-run] indexaría ${chunk.id}: "${chunk.title}"`);
      newChunks.push({ ...chunk, embedding: cached?.embedding || [] });
      continue;
    }

    chunk.embedding = await embedWithRetry(chunk.content);
    newChunks.push(chunk);
    embedded += 1;
    console.log(`Indexado ${chunk.id}: "${chunk.title}"`);
  }

  const finalChunks = [...keepChunks, ...newChunks];

  if (DRY_RUN) {
    console.log(`[dry-run] no se escribió el índice.`);
    console.log(`  conocimiento curado (sin tocar): ${keepChunks.length}`);
    console.log(`  historial reutilizado sin cambios: ${reused}`);
    console.log(`  historial que se indexaría: ${newChunks.length - reused}`);
    console.log(`  omitidos (sin contenido útil o error): ${skipped}`);
    return;
  }

  mkdirSync(resolve('data'), { recursive: true });
  writeFileSync(INDEX_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    embeddingModel: EMBEDDING_MODEL,
    chunks: finalChunks
  }, null, 2));

  console.log(`Índice actualizado: ${INDEX_PATH}`);
  console.log(`  conocimiento curado preservado: ${keepChunks.length}`);
  console.log(`  historial reutilizado (sin cambios): ${reused}`);
  console.log(`  historial nuevo/actualizado: ${embedded}`);
  console.log(`  omitidos (sin contenido útil o error): ${skipped}`);
  console.log(`  total de fragmentos en el índice: ${finalChunks.length}`);
}

async function listResolvedCandidates() {
  const results = [];
  let startIndex = 1;
  let hasMore = true;
  let pages = 0;
  const sinceMs = SINCE ? Date.parse(SINCE) : null;

  while (hasMore && pages < MAX_PAGES) {
    pages += 1;
    const listInfo = {
      row_count: PAGE_SIZE,
      start_index: startIndex,
      sort_field: 'last_updated_time',
      sort_order: 'desc',
      // status.id 3 = Cerrado, 4 = Resuelto (ver /requests/status -- los nombres mostrados son en
      // español y no coinciden con el internal_name en inglés, así que se filtra por id).
      search_criteria: { field: 'status.id', condition: 'in', values: ['3', '4'] },
      fields_required: ['subject', 'status', 'last_updated_time', 'template']
    };

    const response = await sdpClient.get('/requests', {
      params: { input_data: JSON.stringify({ list_info: listInfo }) }
    });

    const pageRequests = response.data?.requests || [];
    let stoppedBySince = false;
    for (const request of pageRequests) {
      const updatedMs = Number(request.last_updated_time?.value || 0);
      if (sinceMs && updatedMs && updatedMs < sinceMs) {
        stoppedBySince = true;
        break;
      }
      // Tickets de prueba (convención usada durante el desarrollo de Sophia: la palabra "prueba"
      // en el asunto, de tickets creados y cerrados de inmediato solo para verificar algo -- ej.
      // "PRUEBA endpoint externo...", "[Recorrido Planta] PRUEBA - SALA DE SERVIDORES...") no son
      // casos reales resueltos -- indexarlos ensuciaría el conocimiento con contenido sintético.
      if (/\bprueba\b/i.test(String(request.subject || ''))) continue;
      results.push(request);
    }

    hasMore = Boolean(response.data?.list_info?.has_more_rows) && !stoppedBySince;
    startIndex += PAGE_SIZE;
  }

  return results;
}

function buildChunkFromRequest(request, lastUpdatedTime) {
  if (!request?.id) return null;

  // El estado pudo cambiar entre el listado (barato) y este detalle (caro) -- se vuelve a validar.
  const status = getDisplayName(request.status);
  if (!isResolvedKnowledgeStatus(status)) return null;

  const resolutionRaw = getResolutionText(request.resolution);
  const descriptionRaw = request.description || request.short_description || '';
  const resolution = redactKnowledgePeople(cleanKnowledgeText(resolutionRaw, 1200), request);
  const description = redactKnowledgePeople(cleanKnowledgeText(descriptionRaw, 900), request);
  if (!resolution && !description) return null;

  const subject = redactKnowledgePeople(cleanKnowledgeText(request.subject || '', 200), request);
  const isMci = isMciRequestData(request);
  const category = getDisplayName(request.category);
  const subcategory = getDisplayName(request.subcategory);
  const priority = getDisplayName(request.priority);
  const closedDisplay = request.last_updated_time?.display_value || '';

  const lines = [];
  if (isMci) {
    const leader = redactKnowledgePeople(getMciLeaderValue(request) || '', request);
    lines.push(leader ? `Caso de MCI (líder: ${leader}): ${subject}` : `Caso de MCI: ${subject}`);
  } else {
    lines.push(`Caso de ticket #${request.id}: ${subject}`);
    const classification = [category, subcategory].filter(Boolean).join(' / ');
    if (classification) lines.push(`Categoría: ${classification}`);
    if (priority) lines.push(`Prioridad: ${priority}`);
  }
  if (description) lines.push(`Problema descrito: ${description}`);
  if (resolution) lines.push(`Cómo se resolvió: ${resolution}`);
  if (closedDisplay) lines.push(`Cerrado: ${closedDisplay}`);

  const content = lines.join('\n');
  if (content.length < 25) return null;

  return {
    id: `${CHUNK_PREFIX}${isMci ? 'mci' : 'ticket'}-${request.id}`,
    requestId: String(request.id),
    lastUpdatedTime: String(lastUpdatedTime || ''),
    source: `SDP #${request.id}`,
    title: subject || `${isMci ? 'MCI' : 'Ticket'} #${request.id}`,
    docType: isMci ? 'mci_resuelta' : 'ticket_resuelto',
    area: category || (isMci ? 'MCI' : 'general'),
    visibility: 'all',
    content
  };
}

async function embedWithRetry(text) {
  let lastError;
  for (let attempt = 1; attempt <= EMBEDDING_RETRIES; attempt += 1) {
    try {
      const result = await embeddingModel.embedContent(String(text || '').slice(0, 12000));
      return result.embedding.values;
    } catch (error) {
      lastError = error;
      console.warn(`Reintentando embedding (${attempt}/${EMBEDDING_RETRIES}): ${error.message}`);
      await new Promise((r) => { setTimeout(r, EMBEDDING_RETRY_DELAY_MS); });
    }
  }
  throw lastError;
}

function loadIndex(path) {
  if (!existsSync(path)) return { chunks: [] };
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.warn(`No se pudo leer el índice existente (${path}): ${error.message}. Se parte de uno vacío.`);
    return { chunks: [] };
  }
}

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}
