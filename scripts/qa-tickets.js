import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const LOG_PATH = resolve(process.env.AUDIT_LOG_PATH || 'audit.log');
const KNOWLEDGE_CANDIDATES_PATH = resolve(process.env.KNOWLEDGE_CANDIDATES_PATH || 'data/knowledge-candidates.json');
const OUTPUT_PATH = getArgValue('--output');
const FORMAT = getArgValue('--format') || 'text';
const DAYS = Number(getArgValue('--days') || process.env.QA_TICKETS_DAYS || 7);
const EXPLICIT_SINCE = getArgValue('--since');
const SINCE = EXPLICIT_SINCE || getSinceFromDays(DAYS);
const PERIOD_KEY = EXPLICIT_SINCE ? `since:${EXPLICIT_SINCE}` : `days:${DAYS}`;
const LIMIT = Number(getArgValue('--limit') || process.env.QA_TICKETS_LIMIT || 1000);
const EMIT_CANDIDATES = hasFlag('--emit-candidates');

if (!existsSync(LOG_PATH)) {
  console.error(`No existe el archivo de auditoria: ${LOG_PATH}`);
  process.exit(1);
}

const records = readAuditRecords(LOG_PATH)
  .filter((record) => record.toolName === 'sdp_create_request')
  .filter((record) => !SINCE || Date.parse(record.timestamp || 0) >= Date.parse(SINCE))
  .slice(-LIMIT);

const analysis = analyze(records);
let emittedCandidates = [];

if (EMIT_CANDIDATES) {
  emittedCandidates = emitKnowledgeCandidates(analysis);
  analysis.emittedCandidates = emittedCandidates.map((candidate) => ({
    id: candidate.id,
    type: candidate.type,
    title: candidate.title
  }));
}

if (FORMAT === 'json') {
  writeOrPrint(JSON.stringify(analysis, null, 2));
} else if (FORMAT === 'md' || FORMAT === 'markdown') {
  writeOrPrint(renderMarkdown(analysis));
} else {
  writeOrPrint(renderText(analysis, emittedCandidates));
}

function readAuditRecords(path) {
  return readFileSync(path, 'utf8')
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

function analyze(items) {
  const created = items.filter(isCreatedSuccess);
  const errors = items.filter(isErrorOutcome);
  const prepared = items.filter((record) => record.outcome === 'confirmation_required');
  const expired = items.filter((record) => record.outcome === 'confirmation_expired');
  const cancelled = items.filter((record) => record.outcome === 'confirmation_cancelled' || record.outcome === 'cancelled');
  const lowConfidence = items.filter(hasLowConfidence);
  const defaultRoute = items.filter(hasDefaultRoute);
  const missingCategory = items.filter((record) => !record.args?.category);
  const missingSubcategory = items.filter((record) => !record.args?.subcategory);
  const highWithoutEvidence = items.filter(hasHighPriorityWithoutEvidence);
  const sdpFieldErrors = summarizeFieldErrors(errors);
  const routes = summarizeByRoute(items);
  const categories = summarizeByCategory(items);
  const users = summarizeByUser(items);
  const findings = buildFindings({
    items,
    created,
    errors,
    lowConfidence,
    defaultRoute,
    missingCategory,
    missingSubcategory,
    highWithoutEvidence,
    sdpFieldErrors
  });

  return {
    generatedAt: new Date().toISOString(),
    source: relativePath(LOG_PATH),
    since: SINCE || null,
    limit: LIMIT,
    summary: {
      totalCreateRequestEvents: items.length,
      prepared: prepared.length,
      created: created.length,
      errors: errors.length,
      expired: expired.length,
      cancelled: cancelled.length,
      lowConfidence: lowConfidence.length,
      defaultRoute: defaultRoute.length,
      missingCategory: missingCategory.length,
      missingSubcategory: missingSubcategory.length,
      highPriorityWithoutImpactEvidence: highWithoutEvidence.length
    },
    sdpFieldErrors,
    routes,
    categories,
    users,
    findings,
    examples: {
      lowConfidence: lowConfidence.slice(-5).map(toExample),
      defaultRoute: defaultRoute.slice(-5).map(toExample),
      errors: errors.slice(-5).map(toExample),
      highPriorityWithoutImpactEvidence: highWithoutEvidence.slice(-5).map(toExample)
    }
  };
}

function isCreatedSuccess(record) {
  return ['confirmed_success', 'success'].includes(record.outcome);
}

function isErrorOutcome(record) {
  return Boolean(record.error) || String(record.outcome || '').includes('error');
}

function hasLowConfidence(record) {
  const confidence = getClassification(record).confidence;
  const normalized = normalize(confidence);
  return normalized.includes('baja') || normalized.includes('default') || normalized.includes('media sin regla');
}

function hasDefaultRoute(record) {
  const routing = getClassification(record).routing;
  return !routing || routing === 'default';
}

function hasHighPriorityWithoutEvidence(record) {
  if (normalize(record.args?.priority) !== 'alta') return false;
  const text = normalize([
    record.args?.subject,
    record.args?.description_preview,
    record.args?.description
  ].filter(Boolean).join(' '));

  const highImpactSignals = [
    'varios usuarios',
    'area completa',
    'área completa',
    'bloquea',
    'no se puede operar',
    'ventas',
    'despacho',
    'produccion',
    'producción',
    'facturacion',
    'facturación',
    'caja',
    'bodega',
    'critico',
    'crítico',
    'urgente'
  ];

  return !highImpactSignals.some((signal) => text.includes(normalize(signal)));
}

function summarizeFieldErrors(records) {
  const counts = new Map();
  for (const record of records) {
    const fields = Array.isArray(record.error?.fields) && record.error.fields.length
      ? record.error.fields
      : [record.error?.message || 'sin_detalle'];
    for (const field of fields) {
      const key = String(field || 'unknown');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([field, count]) => ({ field, count }));
}

function summarizeByRoute(records) {
  const counts = new Map();
  for (const record of records) {
    const route = getClassification(record).routing || 'default';
    counts.set(route, (counts.get(route) || 0) + 1);
  }
  return toSortedCountRows(counts, 'route');
}

function summarizeByCategory(records) {
  const counts = new Map();
  for (const record of records) {
    const key = [record.args?.category || 'sin_categoria', record.args?.subcategory || 'sin_subcategoria'].join(' / ');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return toSortedCountRows(counts, 'category');
}

function summarizeByUser(records) {
  const counts = new Map();
  for (const record of records) {
    const key = record.user?.name || 'sin_usuario';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return toSortedCountRows(counts, 'user').slice(0, 10);
}

function toSortedCountRows(counts, keyName) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ [keyName]: key, count }));
}

function buildFindings({ items, created, errors, lowConfidence, defaultRoute, missingCategory, missingSubcategory, highWithoutEvidence, sdpFieldErrors }) {
  const findings = [];

  if (!items.length) {
    findings.push({
      severity: 'info',
      title: 'No hay datos de creación de tickets en el periodo',
      action: 'Amplía el rango con --days 30 o revisa que audit.log tenga eventos sdp_create_request.'
    });
    return findings;
  }

  if (errors.length > 0) {
    findings.push({
      severity: 'alta',
      title: `${errors.length} evento(s) terminaron en error`,
      action: sdpFieldErrors.length
        ? `Prioriza corregir campos SDP: ${sdpFieldErrors.slice(0, 3).map((item) => `${item.field} (${item.count})`).join(', ')}.`
        : 'Revisa los errores recientes y agrega reglas en knowledge/errores-sdp.md si aplican.'
    });
  }

  if (defaultRoute.length > 0) {
    findings.push({
      severity: 'media',
      title: `${defaultRoute.length} evento(s) usaron ruta default o sin ruta`,
      action: 'Revisa si requieren reglas en knowledge/catalogo-sdp.md o playbooks específicos.'
    });
  }

  if (lowConfidence.length > 0) {
    findings.push({
      severity: 'media',
      title: `${lowConfidence.length} evento(s) tuvieron baja confianza de clasificación`,
      action: 'Ejecuta npm run knowledge:candidates y revisa candidatos de baja confianza.'
    });
  }

  if (missingCategory.length || missingSubcategory.length) {
    findings.push({
      severity: 'alta',
      title: `Campos incompletos: categoria=${missingCategory.length}, subcategoria=${missingSubcategory.length}`,
      action: 'Asegura que cada ruta determinística tenga categoría y subcategoría válidas para SDP.'
    });
  }

  if (highWithoutEvidence.length > 0) {
    findings.push({
      severity: 'media',
      title: `${highWithoutEvidence.length} ticket(s) con prioridad Alta sin evidencia clara de impacto`,
      action: 'Refuerza triage de prioridad para exigir impacto operativo antes de conservar Alta.'
    });
  }

  const successRate = items.length ? Math.round((created.length / items.length) * 100) : 0;
  findings.push({
    severity: successRate >= 70 ? 'info' : 'media',
    title: `Tasa de creación confirmada: ${successRate}%`,
    action: 'Usa esta métrica con cautela: confirmation_required no necesariamente implica fallo, puede estar esperando confirmación del usuario.'
  });

  return findings;
}

function toExample(record) {
  const classification = getClassification(record);
  return {
    timestamp: record.timestamp,
    outcome: record.outcome,
    user: record.user?.name || '',
    subject: record.args?.subject || '',
    category: record.args?.category || '',
    subcategory: record.args?.subcategory || '',
    priority: record.args?.priority || '',
    routing: classification.routing || '',
    confidence: classification.confidence || '',
    error: record.error ? formatError(record.error) : ''
  };
}

function renderText(data, emitted = []) {
  const lines = [
    'Sophia ticket QA',
    `Generado: ${data.generatedAt}`,
    `Fuente: ${data.source}`,
    `Desde: ${data.since || 'todo el log'}`,
    '',
    'Resumen',
    '-------',
    `Eventos sdp_create_request: ${data.summary.totalCreateRequestEvents}`,
    `Preparados para confirmacion: ${data.summary.prepared}`,
    `Creados con exito: ${data.summary.created}`,
    `Errores: ${data.summary.errors}`,
    `Confirmaciones expiradas: ${data.summary.expired}`,
    `Baja confianza: ${data.summary.lowConfidence}`,
    `Ruta default/sin ruta: ${data.summary.defaultRoute}`,
    `Sin categoria: ${data.summary.missingCategory}`,
    `Sin subcategoria: ${data.summary.missingSubcategory}`,
    `Alta sin evidencia de impacto: ${data.summary.highPriorityWithoutImpactEvidence}`,
    '',
    'Hallazgos',
    '---------',
    ...data.findings.map((finding, index) => `${index + 1}. [${finding.severity}] ${finding.title}\n   Accion: ${finding.action}`),
    '',
    'Top rutas',
    '---------',
    ...renderCountLines(data.routes, 'route'),
    '',
    'Top categorias',
    '--------------',
    ...renderCountLines(data.categories, 'category'),
    '',
    'Errores SDP por campo',
    '---------------------',
    ...(data.sdpFieldErrors.length ? data.sdpFieldErrors.map((item) => `- ${item.field}: ${item.count}`) : ['- Sin errores de campos SDP.']),
    '',
    'Comandos utiles',
    '----------------',
    '  npm run audit:created-tickets -- --errors',
    '  npm run knowledge:candidates',
    '  npm run knowledge:review',
    '  npm run routing:check'
  ];

  if (EMIT_CANDIDATES) {
    lines.push(
      '',
      'Candidatos QA emitidos',
      '----------------------',
      emitted.length
        ? emitted.map((candidate) => `- ${candidate.id} [${candidate.type}] ${candidate.title}`).join('\n')
        : '- No se emitieron candidatos nuevos; ya existían o no hubo hallazgos aplicables.',
      `Archivo: ${relativePath(KNOWLEDGE_CANDIDATES_PATH)}`
    );
  }

  return lines.join('\n');
}

function renderMarkdown(data) {
  return [
    '# Sophia ticket QA',
    '',
    `Generado: ${data.generatedAt}`,
    `Fuente: \`${data.source}\``,
    `Desde: ${data.since || 'todo el log'}`,
    '',
    '## Resumen',
    '',
    renderMarkdownTable(
      ['Métrica', 'Valor'],
      Object.entries({
        'Eventos sdp_create_request': data.summary.totalCreateRequestEvents,
        'Preparados para confirmación': data.summary.prepared,
        'Creados con éxito': data.summary.created,
        'Errores': data.summary.errors,
        'Confirmaciones expiradas': data.summary.expired,
        'Baja confianza': data.summary.lowConfidence,
        'Ruta default/sin ruta': data.summary.defaultRoute,
        'Sin categoría': data.summary.missingCategory,
        'Sin subcategoría': data.summary.missingSubcategory,
        'Alta sin evidencia de impacto': data.summary.highPriorityWithoutImpactEvidence
      })
    ),
    '',
    '## Hallazgos',
    '',
    ...data.findings.map((finding, index) => `${index + 1}. **[${finding.severity}] ${escapeMarkdown(finding.title)}**\n\n   Acción: ${escapeMarkdown(finding.action)}`),
    '',
    '## Top rutas',
    '',
    renderMarkdownTable(['Ruta', 'Cantidad'], data.routes.map((item) => [item.route, item.count])),
    '',
    '## Top categorías',
    '',
    renderMarkdownTable(['Categoría', 'Cantidad'], data.categories.map((item) => [item.category, item.count])),
    '',
    '## Errores SDP por campo',
    '',
    data.sdpFieldErrors.length
      ? renderMarkdownTable(['Campo', 'Cantidad'], data.sdpFieldErrors.map((item) => [item.field, item.count]))
      : '_Sin errores de campos SDP._',
    '',
    '## Ejemplos recientes con error',
    '',
    renderExampleTable(data.examples.errors),
    '',
    ...(EMIT_CANDIDATES ? [
      '## Candidatos QA emitidos',
      '',
      data.emittedCandidates?.length
        ? renderMarkdownTable(['ID', 'Tipo', 'Título'], data.emittedCandidates.map((candidate) => [candidate.id, candidate.type, candidate.title]))
        : '_No se emitieron candidatos nuevos; ya existían o no hubo hallazgos aplicables._'
    ] : []),
    ''
  ].join('\n');
}

function emitKnowledgeCandidates(data) {
  const store = readCandidateStore(KNOWLEDGE_CANDIDATES_PATH);
  const existingFingerprints = new Set((store.candidates || []).map((candidate) => candidate.fingerprint).filter(Boolean));
  const generated = createQaKnowledgeCandidates(data)
    .filter((candidate) => candidate && !existingFingerprints.has(candidate.fingerprint));

  if (!generated.length) return [];

  const nextStore = {
    version: 1,
    updatedAt: new Date().toISOString(),
    candidates: [
      ...(store.candidates || []),
      ...generated
    ]
  };

  mkdirSync(dirname(KNOWLEDGE_CANDIDATES_PATH), { recursive: true });
  writeFileSync(KNOWLEDGE_CANDIDATES_PATH, JSON.stringify(nextStore, null, 2), 'utf8');
  return generated;
}

function readCandidateStore(path) {
  if (!existsSync(path)) return { version: 1, candidates: [] };
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return {
      version: data.version || 1,
      candidates: Array.isArray(data.candidates) ? data.candidates : []
    };
  } catch {
    return { version: 1, candidates: [] };
  }
}

function createQaKnowledgeCandidates(data) {
  return [
    createDefaultRouteCandidate(data),
    createMissingSubcategoryCandidate(data),
    createHighPriorityCandidate(data),
    createSdpFieldErrorCandidate(data),
    createLowConfidenceCandidate(data)
  ].filter(Boolean);
}

function createDefaultRouteCandidate(data) {
  if (data.summary.defaultRoute <= 0) return null;
  const examples = data.examples.defaultRoute || [];
  return createCandidate({
    type: 'qa_ticket_default_route',
    title: `QA tickets: ${data.summary.defaultRoute} evento(s) con ruta default`,
    evidence: `${data.summary.defaultRoute} evento(s) de creación usaron ruta default o sin ruta desde ${data.since || 'todo el log'}.`,
    suggestedKnowledge: 'Revisar los asuntos y descripciones que caen en ruta default. Si hay patrones claros, agregar reglas en knowledge/catalogo-sdp.md o playbooks específicos para evitar clasificaciones genéricas.',
    examples,
    fingerprintSeed: `qa:default_route:${PERIOD_KEY}:${data.summary.defaultRoute}:${examples.map((item) => item.subject).join('|')}`
  });
}

function createMissingSubcategoryCandidate(data) {
  if (data.summary.missingCategory <= 0 && data.summary.missingSubcategory <= 0) return null;
  return createCandidate({
    type: 'qa_ticket_missing_fields',
    title: `QA tickets: campos de clasificación incompletos`,
    evidence: `Eventos con categoría faltante: ${data.summary.missingCategory}. Eventos con subcategoría faltante: ${data.summary.missingSubcategory}.`,
    suggestedKnowledge: 'Revisar rutas determinísticas y catálogo SDP para asegurar que cada caso tenga categoría y subcategoría válidas antes de preparar tickets.',
    examples: [
      ...(data.examples.defaultRoute || []),
      ...(data.examples.errors || [])
    ].slice(0, 5),
    fingerprintSeed: `qa:missing_fields:${PERIOD_KEY}:${data.summary.missingCategory}:${data.summary.missingSubcategory}`
  });
}

function createHighPriorityCandidate(data) {
  if (data.summary.highPriorityWithoutImpactEvidence <= 0) return null;
  return createCandidate({
    type: 'qa_ticket_priority_triage',
    title: `QA tickets: prioridad Alta sin evidencia clara`,
    evidence: `${data.summary.highPriorityWithoutImpactEvidence} ticket(s) fueron preparados con prioridad Alta sin señales claras de impacto operativo en el asunto o descripción.`,
    suggestedKnowledge: 'Refinar el triage de prioridad: conservar Alta solo cuando haya bloqueo operativo, varios usuarios, área completa o impacto en ventas, despacho, producción, facturación, caja o bodega.',
    examples: data.examples.highPriorityWithoutImpactEvidence || [],
    fingerprintSeed: `qa:high_priority_without_evidence:${PERIOD_KEY}:${data.summary.highPriorityWithoutImpactEvidence}`
  });
}

function createSdpFieldErrorCandidate(data) {
  if (!data.sdpFieldErrors.length) return null;
  const top = data.sdpFieldErrors.slice(0, 3);
  return createCandidate({
    type: 'qa_ticket_sdp_errors',
    title: `QA tickets: errores SDP en creación`,
    evidence: `Errores SDP detectados: ${top.map((item) => `${item.field} (${item.count})`).join(', ')}.`,
    suggestedKnowledge: 'Revisar si estos errores requieren reglas internas en knowledge/errores-sdp.md o ajustes de integración. Sophia no debe pedir al usuario campos internos de SDP.',
    examples: data.examples.errors || [],
    fingerprintSeed: `qa:sdp_errors:${PERIOD_KEY}:${top.map((item) => `${item.field}:${item.count}`).join('|')}`
  });
}

function createLowConfidenceCandidate(data) {
  if (data.summary.lowConfidence <= 0) return null;
  return createCandidate({
    type: 'qa_ticket_low_confidence',
    title: `QA tickets: baja confianza de clasificación`,
    evidence: `${data.summary.lowConfidence} evento(s) tuvieron confianza baja, default o media sin regla directa.`,
    suggestedKnowledge: 'Revisar candidatos de baja confianza y decidir si se necesitan reglas nuevas en el catálogo o playbooks.',
    examples: data.examples.lowConfidence || [],
    fingerprintSeed: `qa:low_confidence:${PERIOD_KEY}:${data.summary.lowConfidence}`
  });
}

function createCandidate({ type, title, evidence, suggestedKnowledge, examples = [], fingerprintSeed }) {
  const fingerprint = hash(fingerprintSeed || `${type}:${title}:${suggestedKnowledge}`);
  return {
    id: `kc_${fingerprint.slice(0, 12)}`,
    fingerprint,
    type,
    title,
    status: 'pending_review',
    source: 'qa:tickets',
    createdAt: new Date().toISOString(),
    evidence,
    suggested_knowledge: suggestedKnowledge,
    examples
  };
}

function hash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function renderCountLines(items, key) {
  if (!items.length) return ['- Sin datos.'];
  return items.slice(0, 10).map((item) => `- ${item[key]}: ${item.count}`);
}

function renderExampleTable(examples) {
  if (!examples.length) return '_Sin ejemplos._';
  return renderMarkdownTable(
    ['Fecha', 'Resultado', 'Usuario', 'Ruta', 'Categoría', 'Error', 'Asunto'],
    examples.map((example) => [
      example.timestamp,
      example.outcome,
      example.user,
      example.routing,
      [example.category, example.subcategory].filter(Boolean).join(' / '),
      example.error,
      example.subject
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

function getClassification(record) {
  return record.args?.sophia_classification || {};
}

function formatError(error) {
  if (!error) return '';
  const fields = Array.isArray(error.fields) && error.fields.length ? ` campos=${error.fields.join(',')}` : '';
  return `${error.message || 'Error'}${fields}`;
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeMarkdownCell(value) {
  return escapeMarkdown(value).replace(/\n/g, ' ');
}

function escapeMarkdown(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}

function writeOrPrint(content) {
  if (!OUTPUT_PATH) {
    console.log(content);
    return;
  }

  const output = resolve(OUTPUT_PATH);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, content, 'utf8');
  console.log(`Reporte generado: ${output}`);
}

function relativePath(path) {
  return path.replace(`${process.cwd()}/`, '');
}

function getSinceFromDays(days) {
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}
