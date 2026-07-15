import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const INPUT_PATH = resolve(process.env.KNOWLEDGE_CANDIDATES_PATH || 'data/knowledge-candidates.json');
const OUTPUT_PATH = resolve(getArgValue('--output') || process.env.KNOWLEDGE_CANDIDATES_REPORT_PATH || 'reports/knowledge-candidates-latest.md');
const STATUS = getArgValue('--status') || 'pending_review';
const LIMIT = Number(getArgValue('--limit') || process.env.KNOWLEDGE_CANDIDATES_REPORT_LIMIT || 50);
const FORMAT = getArgValue('--format') || 'md';

const store = readStore(INPUT_PATH);
const candidates = (store.candidates || [])
  .filter((candidate) => STATUS === 'all' || candidate.status === STATUS)
  .sort(compareCandidates)
  .slice(0, LIMIT);

const report = FORMAT === 'table'
  ? renderConsoleTable(candidates)
  : renderMarkdownReport(candidates, store);

if (FORMAT === 'table') {
  console.log(report);
} else {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, report, 'utf8');
  console.log(`Reporte generado: ${OUTPUT_PATH}`);
  console.log(`Candidatos incluidos: ${candidates.length}`);
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

function compareCandidates(a, b) {
  const priorityDiff = getCandidatePriority(b) - getCandidatePriority(a);
  if (priorityDiff !== 0) return priorityDiff;
  return Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
}

function getCandidatePriority(candidate) {
  if (candidate.type === 'sdp_error_pattern') return 90;
  if (candidate.type === 'low_confidence_classification') return 70;
  if (candidate.type === 'classification_pattern') return 50;
  return 10;
}

function renderMarkdownReport(candidates, store) {
  const all = store.candidates || [];
  const pending = all.filter((candidate) => candidate.status === 'pending_review');
  const byType = countBy(candidates, (candidate) => candidate.type);

  const lines = [
    '# Candidatos de conocimiento para Sophia',
    '',
    `Generado: ${new Date().toISOString()}`,
    `Fuente: \`${relativePath(INPUT_PATH)}\``,
    `Estado filtrado: \`${STATUS}\``,
    '',
    '## Resumen',
    '',
    `- Total de candidatos almacenados: ${all.length}`,
    `- Pendientes de revisión: ${pending.length}`,
    `- Incluidos en este reporte: ${candidates.length}`,
    '',
    '## Por tipo',
    '',
    renderMarkdownTable(['Tipo', 'Cantidad'], Object.entries(byType).map(([type, count]) => [type, count])),
    '',
    '## Revisión recomendada',
    '',
    'Prioriza primero los errores SDP, luego clasificaciones de baja confianza y finalmente patrones confirmados.',
    '',
    ...candidates.flatMap(renderCandidateSection),
    ''
  ];

  return lines.join('\n');
}

function renderCandidateSection(candidate, index) {
  const examples = Array.isArray(candidate.examples) ? candidate.examples : [];
  return [
    `## ${index + 1}. ${candidate.title || candidate.id}`,
    '',
    `- ID: \`${candidate.id}\``,
    `- Tipo: \`${candidate.type || 'unknown'}\``,
    `- Estado: \`${candidate.status || 'unknown'}\``,
    `- Prioridad de revisión: ${getCandidatePriorityLabel(candidate)}`,
    `- Fuente: \`${candidate.source || 'n/a'}\``,
    `- Creado: ${candidate.createdAt || 'n/a'}`,
    '',
    '### Evidencia',
    '',
    sanitizeMarkdownText(candidate.evidence || 'Sin evidencia registrada.'),
    '',
    '### Conocimiento sugerido',
    '',
    sanitizeMarkdownText(candidate.suggested_knowledge || 'Sin sugerencia registrada.'),
    '',
    '### Acción sugerida',
    '',
    renderRecommendedAction(candidate),
    '',
    ...(examples.length ? [
      '### Ejemplos',
      '',
      renderExamples(examples),
      ''
    ] : [])
  ];
}

function getCandidatePriorityLabel(candidate) {
  const score = getCandidatePriority(candidate);
  if (score >= 90) return 'Alta';
  if (score >= 70) return 'Media';
  return 'Normal';
}

function renderRecommendedAction(candidate) {
  if (candidate.type === 'sdp_error_pattern') {
    return 'Revisar si el error ya está cubierto en `knowledge/errores-sdp.md`. Si no, agregar una regla de corrección interna o ajustar integración.';
  }
  if (candidate.type === 'low_confidence_classification') {
    return 'Decidir si amerita una regla nueva en `knowledge/catalogo-sdp.md` o en un playbook específico.';
  }
  if (candidate.type === 'classification_pattern') {
    return 'Validar que el patrón sea correcto y, si se repite, convertirlo en regla explícita de clasificación.';
  }
  return 'Revisar manualmente y decidir si se aprueba, descarta o se mantiene pendiente.';
}

function renderExamples(examples) {
  const rows = examples.map((example) => [
    example.timestamp || '',
    example.user || '',
    example.subject || example.toolName || '',
    example.category && example.subcategory
      ? `${example.category} / ${example.subcategory}`
      : (Array.isArray(example.fields) ? example.fields.join(', ') : ''),
    example.error || example.descriptionPreview || ''
  ]);

  return renderMarkdownTable(['Fecha', 'Usuario', 'Caso', 'Ruta/Campos', 'Detalle'], rows);
}

function renderConsoleTable(candidates) {
  if (!candidates.length) return 'No hay candidatos con el filtro indicado.';
  const rows = candidates.map((candidate) => ({
    id: candidate.id || '',
    type: candidate.type || '',
    priority: getCandidatePriorityLabel(candidate),
    title: truncate(candidate.title || '', 64),
    status: candidate.status || ''
  }));
  const columns = [
    ['id', 'ID'],
    ['priority', 'Prioridad'],
    ['type', 'Tipo'],
    ['status', 'Estado'],
    ['title', 'Título']
  ];
  const widths = Object.fromEntries(columns.map(([key, label]) => [
    key,
    Math.max(label.length, ...rows.map((row) => String(row[key]).length))
  ]));
  return [
    columns.map(([key, label]) => label.padEnd(widths[key])).join('  '),
    columns.map(([key]) => '-'.repeat(widths[key])).join('  '),
    ...rows.map((row) => columns.map(([key]) => String(row[key]).padEnd(widths[key])).join('  '))
  ].join('\n');
}

function renderMarkdownTable(headers, rows) {
  if (!rows.length) return '_Sin datos._';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`)
  ].join('\n');
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item) || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function sanitizeMarkdownText(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function escapeMarkdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function truncate(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function relativePath(path) {
  return path.replace(`${process.cwd()}/`, '');
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}
