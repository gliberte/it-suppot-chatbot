import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, extname, join, relative } from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

const KNOWLEDGE_DIR = process.env.RAG_KNOWLEDGE_DIR || 'knowledge';
const INDEX_PATH = process.env.RAG_INDEX_PATH || 'data/rag-index.json';
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const CHUNK_SIZE = Number(process.env.RAG_CHUNK_SIZE || 1600);
const CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP || 180);
const EMBEDDING_RETRIES = Number(process.env.RAG_EMBEDDING_RETRIES || 4);
const EMBEDDING_RETRY_DELAY_MS = Number(process.env.RAG_EMBEDDING_RETRY_DELAY_MS || 2500);

if (!process.env.GEMINI_API_KEY) {
  console.error('Falta GEMINI_API_KEY para generar embeddings.');
  process.exit(1);
}

if (!existsSync(KNOWLEDGE_DIR)) {
  console.error(`No existe la carpeta de conocimiento: ${KNOWLEDGE_DIR}`);
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

const files = listMarkdownFiles(KNOWLEDGE_DIR);
const chunks = [];

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const { metadata, body } = parseFrontmatter(raw);
  const title = metadata.title || basename(file, extname(file));
  const textChunks = chunkText(body, CHUNK_SIZE, CHUNK_OVERLAP);

  for (let index = 0; index < textChunks.length; index += 1) {
    const content = textChunks[index];
    const embedding = await embed(content);
    chunks.push({
      id: `${relative(KNOWLEDGE_DIR, file)}#${index + 1}`,
      source: relative(process.cwd(), file),
      title,
      docType: metadata.doc_type || metadata.docType || 'knowledge',
      area: metadata.area || 'general',
      visibility: metadata.visibility || 'all',
      content,
      embedding
    });
    console.log(`Indexado ${relative(process.cwd(), file)} chunk ${index + 1}/${textChunks.length}`);
  }
}

mkdirSync(join(process.cwd(), 'data'), { recursive: true });
writeFileSync(INDEX_PATH, JSON.stringify({
  generatedAt: new Date().toISOString(),
  embeddingModel: EMBEDDING_MODEL,
  chunks
}, null, 2));

console.log(`Índice RAG generado: ${INDEX_PATH} (${chunks.length} fragmentos)`);

function listMarkdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(fullPath);
    if (entry.isFile() && ['.md', '.txt'].includes(extname(entry.name).toLowerCase())) return [fullPath];
    return [];
  });
}

function parseFrontmatter(raw) {
  if (!raw.startsWith('---\n')) return { metadata: {}, body: raw.trim() };
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return { metadata: {}, body: raw.trim() };

  const frontmatter = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).trim();
  const metadata = {};

  for (const line of frontmatter.split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    metadata[key] = value;
  }

  return { metadata, body };
}

function chunkText(text, size, overlap) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return [];

  const sections = normalized.split(/\n(?=#{1,3}\s)/g);
  const chunks = [];

  for (const section of sections) {
    if (section.length <= size) {
      chunks.push(section.trim());
      continue;
    }

    chunks.push(...sliceLongSection(section, size, overlap));
  }

  return chunks;
}

function sliceLongSection(text, size, overlap) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end === text.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

async function embed(text) {
  let lastError;
  for (let attempt = 0; attempt <= EMBEDDING_RETRIES; attempt += 1) {
    try {
      const result = await embeddingModel.embedContent(text.slice(0, 12000));
      return result.embedding.values;
    } catch (error) {
      lastError = error;
      const shouldRetry = error.status === 429 || error.status >= 500;
      if (!shouldRetry || attempt === EMBEDDING_RETRIES) break;
      const delay = EMBEDDING_RETRY_DELAY_MS * (attempt + 1);
      console.warn(`Embedding falló (${error.status || error.message}). Reintentando en ${delay} ms...`);
      await sleep(delay);
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
