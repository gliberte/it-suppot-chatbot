import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const AUDIT_LOG_PATH = resolve(process.env.AUDIT_LOG_PATH || 'audit.log');
const OUTPUT_PATH = resolve(process.env.KNOWLEDGE_CANDIDATES_PATH || 'data/knowledge-candidates.json');
const FORMAT = getArgValue('--format') || 'summary';
const LIMIT = Number(getArgValue('--limit') || process.env.KNOWLEDGE_CANDIDATES_LIMIT || 1000);
const SINCE = getArgValue('--since');

const existingStore = readStore(OUTPUT_PATH);
const existingIds = new Set((existingStore.candidates || []).map((candidate) => candidate.id));
const existingFingerprints = new Set((existingStore.candidates || []).map((candidate) => candidate.fingerprint).filter(Boolean));

const records = readAuditRecords(AUDIT_LOG_PATH)
  .filter((record) => !SINCE || new Date(record.timestamp) >= new Date(SINCE))
  .slice(-LIMIT);

const generated = [
  ...createSuccessfulClassificationCandidates(records),
  ...createLowConfidenceCandidates(records),
  ...createSdpErrorCandidates(records)
].filter((candidate) => candidate && !existingFingerprints.has(candidate.fingerprint));

const nextStore = {
  version: 1,
  updatedAt: new Date().toISOString(),
  candidates: [
    ...(existingStore.candidates || []),
    ...generated
  ]
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(nextStore, null, 2), 'utf8');

if (FORMAT === 'json') {
  console.log(JSON.stringify(generated, null, 2));
} else {
  console.log(renderSummary(generated, nextStore));
}

function readAuditRecords(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
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

function readStore(path) {
  if (!existsSync(path)) return { version: 1, candidates: [] };
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return {
      version: 1,
      candidates: Array.isArray(data.candidates) ? data.candidates : []
    };
  } catch {
    return { version: 1, candidates: [] };
  }
}

function createSuccessfulClassificationCandidates(records) {
  const grouped = new Map();

  for (const record of records) {
    if (record.toolName !== 'sdp_create_request') continue;
    if (!['confirmed_success', 'success'].includes(record.outcome)) continue;

    const classification = record.args?.sophia_classification || {};
    const confidence = String(classification.confidence || '').toLowerCase();
    if (!confidence.includes('alta')) continue;

    const categoryPath = [record.args?.category, record.args?.subcategory].filter(Boolean).join(' / ');
    const routing = classification.routing || 'sin_ruta';
    if (!categoryPath || routing === 'default') continue;

    const key = `success:${routing}:${categoryPath}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  }

  return [...grouped.entries()]
    .filter(([, items]) => items.length >= 2)
    .map(([key, items]) => {
      const latest = items[items.length - 1];
      const classification = latest.args?.sophia_classification || {};
      const categoryPath = [latest.args?.category, latest.args?.subcategory].filter(Boolean).join(' / ');
      const keywords = Array.isArray(classification.matchedKeywords) ? classification.matchedKeywords : [];
      return createCandidate({
        type: 'classification_pattern',
        title: `Patrón confirmado: ${categoryPath}`,
        source: 'audit.log',
        evidence: `${items.length} ticket(s) creados exitosamente con ruta ${classification.routing || 'n/a'} y confianza ${classification.confidence || 'n/a'}. Último asunto: ${latest.args?.subject || 'sin asunto'}.`,
        suggestedKnowledge: [
          `Cuando el usuario reporte señales como ${keywords.length ? keywords.join(', ') : 'las señales observadas'}, clasificar como ${categoryPath}.`,
          latest.args?.priority ? `Prioridad típica observada: ${latest.args.priority}.` : ''
        ].filter(Boolean).join(' '),
        examples: items.slice(-3).map((record) => ({
          timestamp: record.timestamp,
          user: record.user?.name,
          subject: record.args?.subject,
          category: record.args?.category,
          subcategory: record.args?.subcategory
        })),
        fingerprintSeed: key
      });
    });
}

function createLowConfidenceCandidates(records) {
  return records
    .filter((record) => record.toolName === 'sdp_create_request')
    .filter((record) => record.outcome === 'confirmation_required')
    .filter((record) => {
      const confidence = String(record.args?.sophia_classification?.confidence || '').toLowerCase();
      return confidence.includes('baja') || confidence.includes('default') || confidence.includes('media_sin_regla');
    })
    .slice(-12)
    .map((record) => {
      const categoryPath = [record.args?.category, record.args?.subcategory].filter(Boolean).join(' / ') || 'sin clasificación clara';
      return createCandidate({
        type: 'low_confidence_classification',
        title: `Revisar clasificación: ${record.args?.subject || 'solicitud sin asunto'}`,
        source: 'audit.log',
        evidence: `Sophia preparó una solicitud con confianza ${record.args?.sophia_classification?.confidence || 'desconocida'} hacia ${categoryPath}.`,
        suggestedKnowledge: `Revisar si el caso "${record.args?.subject || 'sin asunto'}" debe tener una regla de clasificación explícita en el catálogo o playbooks.`,
        examples: [{
          timestamp: record.timestamp,
          user: record.user?.name,
          subject: record.args?.subject,
          category: record.args?.category,
          subcategory: record.args?.subcategory,
          descriptionPreview: record.args?.description_preview
        }],
        fingerprintSeed: `low:${record.timestamp}:${record.args?.subject}:${categoryPath}`
      });
    });
}

function createSdpErrorCandidates(records) {
  const grouped = new Map();

  for (const record of records) {
    if (!record.error) continue;
    const fields = Array.isArray(record.error.fields) ? record.error.fields : [];
    const fieldKey = fields.length ? fields.join(',') : record.error.message || record.outcome;
    const key = `error:${record.toolName}:${fieldKey}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  }

  return [...grouped.entries()]
    .filter(([, items]) => items.length >= 1)
    .map(([key, items]) => {
      const latest = items[items.length - 1];
      const fields = Array.isArray(latest.error?.fields) ? latest.error.fields : [];
      return createCandidate({
        type: 'sdp_error_pattern',
        title: `Error SDP recurrente: ${latest.toolName} ${fields.join(', ') || latest.error?.message || ''}`.trim(),
        source: 'audit.log',
        evidence: `${items.length} ocurrencia(s). Último error: ${latest.error?.message || latest.outcome}. Campos: ${fields.join(', ') || 'n/a'}.`,
        suggestedKnowledge: suggestKnowledgeForError(latest),
        examples: items.slice(-3).map((record) => ({
          timestamp: record.timestamp,
          user: record.user?.name,
          toolName: record.toolName,
          subject: record.args?.subject,
          error: record.error?.message,
          fields: record.error?.fields
        })),
        fingerprintSeed: key
      });
    });
}

function suggestKnowledgeForError(record) {
  const fields = Array.isArray(record.error?.fields) ? record.error.fields : [];
  if (fields.includes('udf_pick_2701')) {
    return 'Confirmar la regla interna para Técnico asignado (`udf_pick_2701`). Sophia no debe pedir este dato al usuario; debe resolverlo por categoría/subcategoría o configuración.';
  }
  if (fields.includes('subcategory')) {
    return 'Confirmar categoría/subcategoría en el catálogo SDP. Sophia debe resolver subcategoría desde el tipo de caso y no pedir campos internos al usuario.';
  }
  if (record.toolName === 'sdp_add_note') {
    return 'Revisar payload de seguimiento. Sophia debe usar `sdp_add_note` con `note_text` y verificar que la nota aparezca luego en SDP.';
  }
  if (record.toolName === 'sdp_update_mci') {
    return 'Revisar despliegue del MCP y mapeo de campos MCI. Las MCI deben actualizarse con `sdp_update_mci`, no con `sdp_update_request`.';
  }
  return 'Revisar este error para determinar si requiere una regla de catálogo, playbook o ajuste de integración.';
}

function createCandidate({
  type,
  title,
  source,
  evidence,
  suggestedKnowledge,
  examples = [],
  fingerprintSeed
}) {
  const fingerprint = hash(fingerprintSeed || `${type}:${title}:${suggestedKnowledge}`);
  const id = `kc_${fingerprint.slice(0, 12)}`;
  if (existingIds.has(id)) return null;
  return {
    id,
    fingerprint,
    type,
    title,
    status: 'pending_review',
    source,
    createdAt: new Date().toISOString(),
    evidence,
    suggested_knowledge: suggestedKnowledge,
    examples
  };
}

function renderSummary(generated, store) {
  const lines = [
    `Candidatos nuevos: ${generated.length}`,
    `Total pendientes: ${(store.candidates || []).filter((candidate) => candidate.status === 'pending_review').length}`,
    `Archivo: ${OUTPUT_PATH}`
  ];

  if (generated.length > 0) {
    lines.push('', 'Nuevos candidatos:');
    for (const candidate of generated.slice(0, 12)) {
      lines.push(`- ${candidate.id} [${candidate.type}] ${candidate.title}`);
    }
  }

  return lines.join('\n');
}

function hash(value) {
  return createHash('sha256').update(String(value || randomUUID())).digest('hex');
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}
