import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const STORE_PATH = resolve(process.env.KNOWLEDGE_CANDIDATES_PATH || 'data/knowledge-candidates.json');
const OUTPUT_PATH = resolve(getArgValue('--output') || process.env.KNOWLEDGE_EXPORT_PATH || 'reports/approved-knowledge-draft.md');
const STATUS = getArgValue('--status') || 'approved';
const LIMIT = Number(getArgValue('--limit') || process.env.KNOWLEDGE_EXPORT_LIMIT || 50);
const ONLY_ID = getArgValue('--id');

const store = readStore(STORE_PATH);
const candidates = getCandidatesForExport();
const draft = renderDraft(candidates);

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, draft, 'utf8');

console.log(`Borrador generado: ${OUTPUT_PATH}`);
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

function getCandidatesForExport() {
  return (store.candidates || [])
    .filter((candidate) => !ONLY_ID || String(candidate.id || '').toLowerCase() === ONLY_ID.toLowerCase())
    .filter((candidate) => STATUS === 'all' || candidate.status === STATUS)
    .sort(compareCandidates)
    .slice(0, LIMIT);
}

function renderDraft(candidates) {
  const lines = [
    '# Borrador de conocimiento aprobado para Sophia',
    '',
    `Generado: ${new Date().toISOString()}`,
    `Fuente: \`${relativePath(STORE_PATH)}\``,
    `Estado exportado: \`${STATUS}\``,
    `Candidatos incluidos: ${candidates.length}`,
    '',
    '## Cómo usar este borrador',
    '',
    '1. Revisa cada candidato y corrige redacción, alcance y categoría si hace falta.',
    '2. Copia solo los bloques válidos al archivo sugerido en `knowledge/`.',
    '3. Ejecuta `npm run rag:ingest` para regenerar el índice RAG.',
    '4. Ejecuta `npm run rag:test` y `npm run routing:check` si cambiaste reglas de clasificación.',
    '',
    'Este archivo no se incorpora automáticamente al RAG.',
    '',
    ...candidates.flatMap(renderCandidateDraft),
    ''
  ];

  return lines.join('\n');
}

function renderCandidateDraft(candidate, index) {
  const target = getSuggestedTarget(candidate);
  const title = candidate.title || candidate.id || `Candidato ${index + 1}`;
  return [
    `## ${index + 1}. ${title}`,
    '',
    `- ID: \`${candidate.id || 'n/a'}\``,
    `- Tipo: \`${candidate.type || 'unknown'}\``,
    `- Estado: \`${candidate.status || 'unknown'}\``,
    `- Prioridad: ${getPriorityLabel(candidate)}`,
    `- Archivo sugerido: \`${target}\``,
    `- Fuente: \`${candidate.source || 'n/a'}\``,
    `- Creado: ${candidate.createdAt || 'n/a'}`,
    candidate.reviewedAt ? `- Revisado: ${candidate.reviewedAt}` : '',
    '',
    '### Evidencia',
    '',
    sanitizeMarkdown(candidate.evidence || 'Sin evidencia registrada.'),
    '',
    '### Bloque sugerido para knowledge/',
    '',
    '````markdown',
    renderKnowledgeBlock(candidate),
    '````',
    '',
    ...(Array.isArray(candidate.examples) && candidate.examples.length ? [
      '### Ejemplos de soporte',
      '',
      renderExamples(candidate.examples),
      ''
    ] : []),
    '### Checklist antes de aplicar',
    '',
    '- [ ] El aprendizaje es correcto y no proviene de un error ya corregido.',
    '- [ ] No contiene datos sensibles innecesarios.',
    '- [ ] La regla no contradice el catálogo SDP actual.',
    '- [ ] El archivo sugerido es el destino correcto.',
    ''
  ].filter((line) => line !== '').join('\n');
}

function renderKnowledgeBlock(candidate) {
  if (candidate.type === 'classification_pattern') {
    return [
      `## ${candidate.title || 'Patrón de clasificación'}`,
      '',
      sanitizeMarkdown(candidate.suggested_knowledge || 'Agregar regla de clasificación validada.'),
      '',
      'Usar esta regla solo cuando las señales del usuario coincidan claramente con el caso observado.'
    ].join('\n');
  }

  if (candidate.type === 'low_confidence_classification') {
    return [
      `## ${candidate.title || 'Clasificación a revisar'}`,
      '',
      sanitizeMarkdown(candidate.suggested_knowledge || 'Definir si este caso requiere una regla explícita de clasificación.'),
      '',
      'Si se aprueba, documentar señales, categoría, subcategoría, prioridad sugerida y excepciones.'
    ].join('\n');
  }

  if (candidate.type === 'sdp_error_pattern') {
    return [
      `## ${candidate.title || 'Error SDP'}`,
      '',
      'Error observado:',
      '',
      '```text',
      sanitizePlainText(candidate.evidence || 'Sin evidencia registrada.'),
      '```',
      '',
      'Corrección sugerida:',
      '',
      sanitizeMarkdown(candidate.suggested_knowledge || 'Revisar si requiere regla interna, ajuste de integración o actualización de playbook.'),
      '',
      'Sophia debe explicar este caso sin pedir al usuario campos internos de SDP.'
    ].join('\n');
  }

  return sanitizeMarkdown(candidate.suggested_knowledge || 'Revisar manualmente este candidato.');
}

function getSuggestedTarget(candidate) {
  if (candidate.type === 'sdp_error_pattern') return 'knowledge/errores-sdp.md';
  if (candidate.type === 'classification_pattern') return 'knowledge/catalogo-sdp.md';
  if (candidate.type === 'low_confidence_classification') return 'knowledge/catalogo-sdp.md o knowledge/playbooks/<tema>.md';
  return 'knowledge/<archivo-apropiado>.md';
}

function renderExamples(examples) {
  return renderMarkdownTable(
    ['Fecha', 'Usuario', 'Caso', 'Ruta/Campos', 'Detalle'],
    examples.map((example) => [
      example.timestamp || '',
      example.user || '',
      example.subject || example.toolName || '',
      example.category && example.subcategory
        ? `${example.category} / ${example.subcategory}`
        : (Array.isArray(example.fields) ? example.fields.join(', ') : ''),
      example.error || example.descriptionPreview || ''
    ])
  );
}

function renderMarkdownTable(headers, rows) {
  if (!rows.length) return '_Sin datos._';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`)
  ].join('\n');
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

function sanitizeMarkdown(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function sanitizePlainText(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function escapeMarkdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function relativePath(path) {
  return path.replace(`${process.cwd()}/`, '');
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}
