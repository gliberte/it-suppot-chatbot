import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const STORE_PATH = resolve(process.env.KNOWLEDGE_CANDIDATES_PATH || 'data/knowledge-candidates.json');
const AUDIT_PATH = resolve(process.env.KNOWLEDGE_CANDIDATES_AUDIT_PATH || 'knowledge-candidates-audit.log');
const STATUS = getArgValue('--status') || 'pending_review';
const LIMIT = Number(getArgValue('--limit') || process.env.KNOWLEDGE_REVIEW_LIMIT || 20);
const DETAIL_ID = getArgValue('--id');
const APPROVE_ID = getArgValue('--approve');
const REJECT_ID = getArgValue('--reject');
const APPLIED_ID = getArgValue('--applied');
const APPLIED_TARGET = getArgValue('--target');
const REVIEW_REASON = getArgValue('--reason');

const store = readStore(STORE_PATH);

if (APPROVE_ID || REJECT_ID || APPLIED_ID) {
  if (APPLIED_ID && !APPLIED_TARGET) {
    console.error('Para marcar como aplicado debes indicar el destino: --target knowledge/<archivo>.md');
    process.exit(1);
  }
  updateCandidateStatus(APPROVE_ID || REJECT_ID || APPLIED_ID, getRequestedStatus(), {
    target: APPLIED_TARGET,
    reason: REVIEW_REASON
  });
} else if (DETAIL_ID) {
  renderCandidateDetail(DETAIL_ID);
} else {
  renderCandidateList();
}

function getRequestedStatus() {
  if (APPROVE_ID) return 'approved';
  if (REJECT_ID) return 'rejected';
  if (APPLIED_ID) return 'applied_to_knowledge';
  return STATUS;
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

function writeStore(nextStore) {
  const tmpPath = `${STORE_PATH}.tmp`;
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(tmpPath, JSON.stringify({
    version: nextStore.version || 1,
    updatedAt: new Date().toISOString(),
    candidates: nextStore.candidates || []
  }, null, 2), 'utf8');
  renameSync(tmpPath, STORE_PATH);
}

function renderCandidateList() {
  const candidates = getFilteredCandidates(STATUS).slice(0, LIMIT);
  const pendingCount = countByStatus('pending_review');
  const approvedCount = countByStatus('approved');
  const appliedCount = countByStatus('applied_to_knowledge');
  const rejectedCount = countByStatus('rejected');

  console.log('Sophia knowledge review');
  console.log(`Archivo: ${relativePath(STORE_PATH)}`);
  console.log(`Actualizado: ${store.updatedAt || 'n/a'}`);
  console.log(`Estado filtrado: ${STATUS}`);
  console.log(`Pendientes: ${pendingCount} | Aprobados: ${approvedCount} | Aplicados: ${appliedCount} | Descartados: ${rejectedCount}`);
  console.log('');

  if (!candidates.length) {
    console.log(`No hay candidatos con estado ${STATUS}.`);
    console.log('');
    console.log('Para generar candidatos nuevos:');
    console.log('  npm run knowledge:candidates');
    return;
  }

  console.log(renderTable(
    ['ID', 'Prioridad', 'Tipo', 'Estado', 'Titulo'],
    candidates.map((candidate) => [
      candidate.id || '',
      getPriorityLabel(candidate),
      candidate.type || '',
      candidate.status || '',
      truncate(candidate.title || '', 68)
    ])
  ));

  console.log('');
  console.log('Comandos de revision');
  console.log('--------------------');
  console.log('  npm run knowledge:review -- --id kc_xxxxx');
  console.log('  npm run knowledge:review -- --approve kc_xxxxx --reason "patron vigente observado en produccion"');
  console.log('  npm run knowledge:review -- --reject kc_xxxxx --reason "error historico ya corregido"');
  console.log('  npm run knowledge:review -- --applied kc_xxxxx --target knowledge/catalogo-sdp.md --reason "documentado en catalogo-sdp"');
  console.log('  npm run knowledge:review -- --status approved');
  console.log('  npm run knowledge:review -- --status applied_to_knowledge');
  console.log('');
  console.log('Nota: aprobar un candidato no lo incorpora automaticamente al RAG.');
  console.log('Despues de aprobar, convierte el aprendizaje en un cambio dentro de knowledge/ y ejecuta npm run rag:ingest.');
}

function renderCandidateDetail(id) {
  const candidate = findCandidate(id);
  if (!candidate) {
    console.error(`No encontre el candidato ${id}.`);
    process.exit(1);
  }

  console.log(`ID: ${candidate.id}`);
  console.log(`Titulo: ${candidate.title || 'Sin titulo'}`);
  console.log(`Tipo: ${candidate.type || 'unknown'}`);
  console.log(`Estado: ${candidate.status || 'unknown'}`);
  console.log(`Prioridad: ${getPriorityLabel(candidate)}`);
  console.log(`Fuente: ${candidate.source || 'n/a'}`);
  console.log(`Creado: ${candidate.createdAt || 'n/a'}`);
  if (candidate.reviewedAt) console.log(`Revisado: ${candidate.reviewedAt}`);
  if (candidate.reviewedBy?.name) console.log(`Revisado por: ${candidate.reviewedBy.name}`);
  if (candidate.reviewReason) console.log(`Motivo revision: ${candidate.reviewReason}`);
  if (candidate.appliedAt) console.log(`Aplicado: ${candidate.appliedAt}`);
  if (candidate.appliedTarget) console.log(`Destino aplicado: ${candidate.appliedTarget}`);
  if (candidate.appliedReason) console.log(`Motivo aplicado: ${candidate.appliedReason}`);
  console.log('');
  console.log('Evidencia');
  console.log('---------');
  console.log(candidate.evidence || 'Sin evidencia registrada.');
  console.log('');
  console.log('Conocimiento sugerido');
  console.log('---------------------');
  console.log(candidate.suggested_knowledge || 'Sin sugerencia registrada.');

  if (Array.isArray(candidate.examples) && candidate.examples.length) {
    console.log('');
    console.log('Ejemplos');
    console.log('--------');
    for (const example of candidate.examples) {
      console.log(`- ${example.timestamp || 'sin fecha'} | ${example.user || 'sin usuario'} | ${example.subject || example.toolName || 'sin caso'}`);
      const route = [example.category, example.subcategory].filter(Boolean).join(' / ');
      if (route) console.log(`  Ruta: ${route}`);
      if (Array.isArray(example.fields) && example.fields.length) console.log(`  Campos: ${example.fields.join(', ')}`);
      if (example.error) console.log(`  Error: ${example.error}`);
      if (example.descriptionPreview) console.log(`  Descripcion: ${example.descriptionPreview}`);
    }
  }

  console.log('');
  console.log('Siguiente paso sugerido');
  console.log('-----------------------');
  console.log(getRecommendedAction(candidate));
  console.log('');
  console.log('Comandos');
  console.log('--------');
  console.log(`  npm run knowledge:review -- --approve ${candidate.id} --reason "patron vigente observado en produccion"`);
  console.log(`  npm run knowledge:review -- --reject ${candidate.id} --reason "error historico ya corregido"`);
  console.log(`  npm run knowledge:review -- --applied ${candidate.id} --target knowledge/<archivo>.md --reason "documentado en knowledge/<archivo>.md"`);
}

function updateCandidateStatus(id, status, options = {}) {
  const candidate = findCandidate(id);
  if (!candidate) {
    console.error(`No encontre el candidato ${id}.`);
    process.exit(1);
  }

  candidate.status = status;
  candidate.reviewedAt = new Date().toISOString();
  candidate.reviewAction = getReviewAction(status);
  candidate.reviewedBy = {
    name: process.env.USER || process.env.LOGNAME || 'cli',
    source: 'knowledge:review'
  };
  if (options.reason) {
    candidate.reviewReason = options.reason;
  }

  if (status === 'applied_to_knowledge') {
    candidate.appliedAt = new Date().toISOString();
    candidate.appliedTarget = options.target;
    if (options.reason) {
      candidate.appliedReason = options.reason;
    }
  }

  writeStore(store);
  appendAuditRecord(candidate);

  console.log(`Listo. ${candidate.id} quedo como ${status}.`);
  if (candidate.reviewReason) console.log(`Motivo: ${candidate.reviewReason}`);
  console.log('');
  if (status === 'approved') {
    console.log('Aprobado no significa incorporado al RAG todavia.');
    console.log('Ahora convierte el aprendizaje en un cambio dentro de knowledge/ y ejecuta:');
    console.log('  npm run rag:ingest');
  } else if (status === 'applied_to_knowledge') {
    console.log(`Aplicado en: ${candidate.appliedTarget}`);
    console.log('Si aun no lo hiciste, regenera y valida el RAG:');
    console.log('  npm run rag:ingest');
    console.log('  npm run rag:test');
  } else {
    console.log('El candidato fue descartado y queda trazable en auditoria.');
  }
}

function getReviewAction(status) {
  if (status === 'approved') return 'approve';
  if (status === 'rejected') return 'reject';
  if (status === 'applied_to_knowledge') return 'applied';
  return status;
}

function appendAuditRecord(candidate) {
  const record = {
    timestamp: new Date().toISOString(),
    action: candidate.reviewAction,
    candidateId: candidate.id,
    candidateType: candidate.type,
    candidateTitle: candidate.title,
    status: candidate.status,
    reviewReason: candidate.reviewReason,
    appliedTarget: candidate.appliedTarget,
    appliedReason: candidate.appliedReason,
    user: candidate.reviewedBy
  };

  try {
    appendFileSync(AUDIT_PATH, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    console.warn(`No pude escribir auditoria ${AUDIT_PATH}: ${error.message}`);
  }
}

function getFilteredCandidates(status) {
  return (store.candidates || [])
    .filter((candidate) => status === 'all' || candidate.status === status)
    .sort(compareCandidates);
}

function findCandidate(id) {
  const normalizedId = String(id || '').toLowerCase();
  return (store.candidates || []).find((candidate) => String(candidate.id || '').toLowerCase() === normalizedId);
}

function countByStatus(status) {
  return (store.candidates || []).filter((candidate) => candidate.status === status).length;
}

function compareCandidates(a, b) {
  const priorityDiff = getPriority(b) - getPriority(a);
  if (priorityDiff !== 0) return priorityDiff;
  return Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
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

function getRecommendedAction(candidate) {
  if (candidate.type === 'sdp_error_pattern') {
    return 'Revisar si el error ya esta cubierto en knowledge/errores-sdp.md. Si no, agregar una regla de correccion interna o ajustar integracion.';
  }
  if (candidate.type === 'low_confidence_classification') {
    return 'Decidir si amerita una regla nueva en knowledge/catalogo-sdp.md o en un playbook especifico.';
  }
  if (candidate.type === 'classification_pattern') {
    return 'Validar que el patron sea correcto y, si se repite, convertirlo en regla explicita de clasificacion.';
  }
  return 'Revisar manualmente y decidir si se aprueba, descarta o se mantiene pendiente.';
}

function renderTable(headers, rows) {
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map((row) => String(row[index] ?? '').length)
  ));

  return [
    headers.map((header, index) => header.padEnd(widths[index])).join('  '),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map((row) => row.map((value, index) => String(value ?? '').padEnd(widths[index])).join('  '))
  ].join('\n');
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
