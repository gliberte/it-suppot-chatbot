import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const STORE_PATH = resolve(process.env.KNOWLEDGE_CANDIDATES_PATH || 'data/knowledge-candidates.json');
const OUTPUT_PATH = resolve(getArgValue('--output') || process.env.KNOWLEDGE_POLISH_PATH || 'reports/polished-knowledge-draft.md');
const STATUS = getArgValue('--status') || 'approved';
const LIMIT = Number(getArgValue('--limit') || process.env.KNOWLEDGE_POLISH_LIMIT || 50);
const ONLY_ID = getArgValue('--id');

const store = readStore(STORE_PATH);
const candidates = getCandidates();
const content = renderPolishedDraft(candidates);

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, content, 'utf8');

console.log(`Borrador pulido generado: ${OUTPUT_PATH}`);
console.log(`Candidatos incluidos: ${candidates.length}`);
if (!candidates.length) {
  console.log(`No hay candidatos con estado ${STATUS}${ONLY_ID ? ` e ID ${ONLY_ID}` : ''}.`);
  console.log('Para aprobar uno primero: npm run knowledge:review -- --approve kc_xxxxx');
}

function readStore(path) {
  if (!existsSync(path)) {
    return { version: 1, candidates: [] };
  }

  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return {
      version: data.version || 1,
      updatedAt: data.updatedAt,
      candidates: Array.isArray(data.candidates) ? data.candidates : []
    };
  } catch (error) {
    console.error(`No pude leer ${path}: ${error.message}`);
    process.exit(1);
  }
}

function getCandidates() {
  return (store.candidates || [])
    .filter((candidate) => !ONLY_ID || String(candidate.id || '').toLowerCase() === ONLY_ID.toLowerCase())
    .filter((candidate) => STATUS === 'all' || candidate.status === STATUS)
    .sort(compareCandidates)
    .slice(0, LIMIT);
}

function renderPolishedDraft(candidates) {
  return [
    '# Conocimiento pulido para Sophia',
    '',
    `Generado: ${new Date().toISOString()}`,
    `Fuente: \`${relativePath(STORE_PATH)}\``,
    `Estado usado: \`${STATUS}\``,
    `Candidatos incluidos: ${candidates.length}`,
    '',
    '## Uso recomendado',
    '',
    '1. Revisa cada bloque pulido.',
    '2. Copia solo los bloques correctos al archivo sugerido.',
    '3. Ajusta redacción, categorías o excepciones según el catálogo real.',
    '4. Ejecuta `npm run rag:ingest` y luego `npm run rag:test`.',
    '5. Marca el candidato como aplicado con `npm run knowledge:review -- --applied kc_xxxxx --target knowledge/<archivo>.md`.',
    '',
    'Este archivo no modifica la base de conocimiento automáticamente.',
    '',
    ...candidates.flatMap(renderPolishedCandidate),
    ''
  ].join('\n');
}

function renderPolishedCandidate(candidate, index) {
  const target = getSuggestedTarget(candidate);
  return [
    `## ${index + 1}. ${cleanTitle(candidate)}`,
    '',
    `- ID: \`${candidate.id || 'n/a'}\``,
    `- Tipo: \`${candidate.type || 'unknown'}\``,
    `- Archivo sugerido: \`${target}\``,
    `- Prioridad de revisión: ${getPriorityLabel(candidate)}`,
    '',
    '### Bloque pulido',
    '',
    '````markdown',
    renderKnowledgeBlock(candidate),
    '````',
    '',
    '### Evidencia resumida',
    '',
    summarizeEvidence(candidate),
    '',
    '### Comandos después de aplicar',
    '',
    '```bash',
    'npm run rag:ingest',
    'npm run rag:test',
    `npm run knowledge:review -- --applied ${candidate.id || 'kc_xxxxx'} --target ${target.includes(' o ') ? 'knowledge/<archivo>.md' : target}`,
    '```',
    ''
  ];
}

function renderKnowledgeBlock(candidate) {
  if (candidate.type === 'classification_pattern') {
    return renderClassificationPattern(candidate);
  }

  if (candidate.type === 'low_confidence_classification') {
    return renderLowConfidenceClassification(candidate);
  }

  if (candidate.type === 'sdp_error_pattern') {
    return renderSdpErrorPattern(candidate);
  }

  return [
    `## ${cleanTitle(candidate)}`,
    '',
    cleanSentence(candidate.suggested_knowledge || 'Revisar y documentar este aprendizaje si aporta valor operativo.'),
    '',
    'Validar manualmente antes de incorporar al RAG.'
  ].join('\n');
}

function renderClassificationPattern(candidate) {
  const route = inferRouteFromExamples(candidate);
  const signals = inferSignals(candidate);
  return [
    `## ${cleanTitle(candidate)}`,
    '',
    route ? `Usar \`${route}\` cuando el usuario reporte señales consistentes con este patrón.` : cleanSentence(candidate.suggested_knowledge || 'Agregar esta regla al catálogo cuando el patrón esté validado.'),
    '',
    'Señales:',
    ...renderBulletList(signals.length ? signals : ['señales observadas en auditoría']),
    '',
    'Qué evitar:',
    '- No aplicar esta regla si el síntoma principal corresponde a otro sistema o categoría.',
    '- No usarla solo por coincidencia parcial de palabras si el contexto apunta a otra causa.',
    '',
    'Notas de operación:',
    '- Mantener la categoría alineada con el catálogo SDP vigente.',
    '- Si cambia la ruta SDP, actualizar también las reglas de clasificación determinística.'
  ].join('\n');
}

function renderLowConfidenceClassification(candidate) {
  const example = Array.isArray(candidate.examples) ? candidate.examples[0] : null;
  const route = example?.category && example?.subcategory ? `${example.category} / ${example.subcategory}` : '';
  return [
    `## ${cleanTitle(candidate)}`,
    '',
    'Revisar si este caso necesita una regla explícita de clasificación.',
    '',
    route ? `Clasificación observada: \`${route}\`.` : 'Clasificación observada: pendiente de confirmar.',
    '',
    'Señales a documentar:',
    ...renderBulletList(inferSignals(candidate, { includeSubjectWords: true })),
    '',
    'Decisión requerida:',
    '- Confirmar categoría y subcategoría correctas.',
    '- Definir prioridad sugerida.',
    '- Documentar excepciones para evitar clasificaciones erróneas.',
    '',
    'Qué evitar:',
    '- No convertir en regla permanente si fue un caso aislado o ya corregido por otra regla.',
    '- No pedir al usuario campos internos de SDP.'
  ].join('\n');
}

function renderSdpErrorPattern(candidate) {
  const fields = inferFields(candidate);
  return [
    `## ${cleanTitle(candidate)}`,
    '',
    'Error observado:',
    '',
    '```text',
    cleanSentence(candidate.evidence || 'Error SDP observado en auditoría.'),
    '```',
    '',
    fields.length ? 'Campos relacionados:' : 'Campos relacionados: pendiente de confirmar.',
    ...renderBulletList(fields),
    '',
    'Corrección interna sugerida:',
    cleanSentence(candidate.suggested_knowledge || 'Revisar si requiere regla interna, ajuste de integración o actualización de playbook.'),
    '',
    'Respuesta recomendada de Sophia:',
    '- Explicar que ServiceDesk Plus rechazó un campo interno o una regla de integración.',
    '- No culpar al usuario.',
    '- No pedir campos técnicos como `udf_pick_*`, IDs internos o payloads.',
    '- No afirmar éxito si la acción fue rechazada por SDP.',
    '',
    'Validación:',
    '- Confirmar si el error sigue vigente antes de documentarlo como regla permanente.',
    '- Si ya fue corregido en código, marcar el candidato como aplicado o descartado según corresponda.'
  ].join('\n');
}

function cleanTitle(candidate) {
  return String(candidate.title || candidate.id || 'Aprendizaje').replace(/^Revisar clasificación:\s*/i, '').trim();
}

function inferRouteFromExamples(candidate) {
  const examples = Array.isArray(candidate.examples) ? candidate.examples : [];
  const found = examples.find((example) => example.category && example.subcategory);
  return found ? `${found.category} / ${found.subcategory}` : '';
}

function inferSignals(candidate, options = {}) {
  const raw = [
    candidate.suggested_knowledge,
    candidate.evidence,
    ...(Array.isArray(candidate.examples) ? candidate.examples.flatMap((example) => [
      example.subject,
      options.includeSubjectWords ? example.descriptionPreview : ''
    ]) : [])
  ].filter(Boolean).join(' ');

  const quoted = [...raw.matchAll(/(?:señales como|senales como)\s+([^,.]+)/gi)]
    .flatMap((match) => match[1].split(/\s+y\s+|,/i));

  const subjects = Array.isArray(candidate.examples)
    ? candidate.examples.map((example) => example.subject).filter(Boolean)
    : [];

  return unique([
    ...quoted,
    ...subjects
  ].map(cleanSignal).filter(Boolean)).slice(0, 8);
}

function inferFields(candidate) {
  const fields = [];
  for (const example of Array.isArray(candidate.examples) ? candidate.examples : []) {
    if (Array.isArray(example.fields)) fields.push(...example.fields);
  }

  const evidenceFields = [...String(candidate.evidence || '').matchAll(/Campos:\s*([^.\n]+)/gi)]
    .flatMap((match) => match[1].split(','));

  return unique([...fields, ...evidenceFields].map(cleanSignal).filter(Boolean));
}

function summarizeEvidence(candidate) {
  const examples = Array.isArray(candidate.examples) ? candidate.examples : [];
  const lines = [
    cleanSentence(candidate.evidence || 'Sin evidencia registrada.')
  ];

  if (examples.length) {
    lines.push('');
    lines.push('Ejemplos:');
    for (const example of examples.slice(0, 3)) {
      const route = example.category && example.subcategory ? ` | ${example.category} / ${example.subcategory}` : '';
      const fields = Array.isArray(example.fields) && example.fields.length ? ` | campos: ${example.fields.join(', ')}` : '';
      lines.push(`- ${example.timestamp || 'sin fecha'} | ${example.user || 'sin usuario'} | ${example.subject || example.toolName || 'sin caso'}${route}${fields}`);
    }
  }

  return lines.join('\n');
}

function getSuggestedTarget(candidate) {
  if (candidate.type === 'sdp_error_pattern') return 'knowledge/errores-sdp.md';
  if (candidate.type === 'classification_pattern') return 'knowledge/catalogo-sdp.md';
  if (candidate.type === 'low_confidence_classification') return 'knowledge/catalogo-sdp.md o knowledge/playbooks/<tema>.md';
  return 'knowledge/<archivo-apropiado>.md';
}

function compareCandidates(a, b) {
  const priorityDiff = getPriority(b) - getPriority(a);
  if (priorityDiff !== 0) return priorityDiff;
  return Date.parse(b.reviewedAt || b.createdAt || 0) - Date.parse(a.reviewedAt || a.createdAt || 0);
}

function getPriority(candidate) {
  if (candidate?.type === 'sdp_error_pattern') return 90;
  if (candidate?.type === 'low_confidence_classification') return 70;
  if (candidate?.type === 'classification_pattern') return 50;
  return 10;
}

function getPriorityLabel(candidate) {
  const priority = getPriority(candidate);
  if (priority >= 90) return 'Alta';
  if (priority >= 70) return 'Media';
  return 'Normal';
}

function renderBulletList(items) {
  const values = unique(items.map(cleanSignal).filter(Boolean));
  if (!values.length) return ['- Pendiente de definir.'];
  return values.map((value) => `- ${value}`);
}

function cleanSentence(value) {
  return String(value || '').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
}

function cleanSignal(value) {
  return String(value || '')
    .replace(/[`*_#]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^["'“”‘’\s:-]+|["'“”‘’\s.:-]+$/g, '')
    .trim();
}

function unique(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function relativePath(path) {
  return path.replace(`${process.cwd()}/`, '');
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}
