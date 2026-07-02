import { existsSync, readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

const DEFAULT_INDEX_PATH = resolve('data/rag-index.json');
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

let cachedIndex = null;
let cachedIndexMtime = null;

export async function searchKnowledge(query, options = {}) {
  if (!process.env.GEMINI_API_KEY) return [];
  const index = loadKnowledgeIndex();
  if (!index?.chunks?.length) return [];

  const queryEmbedding = await embedText(query);
  const role = options.role || 'user';
  const limit = Number(options.limit || process.env.RAG_TOP_K || 5);
  const minScore = Number(options.minScore || process.env.RAG_MIN_SCORE || 0.68);

  return index.chunks
    .filter((chunk) => isVisibleToRole(chunk, role))
    .map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding)
    }))
    .filter((chunk) => chunk.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ embedding, ...chunk }) => chunk);
}

export function formatKnowledgeContext(results = []) {
  if (!results.length) return '';

  return results.map((result, index) => {
    const source = [
      result.source,
      result.title
    ].filter(Boolean).join(' - ');
    return [
      `[${index + 1}] ${source}`,
      `tipo=${result.docType || 'knowledge'} area=${result.area || 'general'} score=${result.score?.toFixed?.(3) || 'n/a'}`,
      result.content
    ].join('\n');
  }).join('\n\n---\n\n');
}

function loadKnowledgeIndex() {
  const indexPath = resolve(process.env.RAG_INDEX_PATH || DEFAULT_INDEX_PATH);

  if (!existsSync(indexPath)) return { chunks: [] };

  const stat = statSync(indexPath);
  const statKey = `${stat.mtimeMs}:${stat.size}:${indexPath}`;
  if (cachedIndex && cachedIndexMtime === statKey) return cachedIndex;

  try {
    cachedIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
    cachedIndexMtime = statKey;
    return cachedIndex;
  } catch (error) {
    console.warn('[RAG] No se pudo cargar el índice de conocimiento:', error.message);
    return { chunks: [] };
  }
}

function isVisibleToRole(chunk, role) {
  const visibility = chunk.visibility || 'all';
  if (visibility === 'all') return true;
  if (visibility === 'admin') return ['support_admin', 'admin'].includes(role);
  if (visibility === 'mci_admin') return ['support_admin', 'admin', 'mci_admin'].includes(role);
  return true;
}

async function embedText(text) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent(String(text || '').slice(0, 12000));
  return result.embedding.values;
}

function cosineSimilarity(a = [], b = []) {
  if (!a.length || !b.length || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
