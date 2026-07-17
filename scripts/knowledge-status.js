import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const STORE_PATH = resolve(process.env.KNOWLEDGE_CANDIDATES_PATH || 'data/knowledge-candidates.json');
const RAG_INDEX_PATH = resolve(process.env.RAG_INDEX_PATH || 'data/rag-index.json');
const EXPORT_PATH = resolve(process.env.KNOWLEDGE_EXPORT_PATH || 'reports/approved-knowledge-draft.md');
const REPORT_PATH = resolve(process.env.KNOWLEDGE_CANDIDATES_REPORT_PATH || 'reports/knowledge-candidates-latest.md');
const AUDIT_PATH = resolve(process.env.KNOWLEDGE_CANDIDATES_AUDIT_PATH || 'knowledge-candidates-audit.log');

const store = readJsonFile(STORE_PATH, { version: 1, candidates: [] });
const ragIndex = readJsonFile(RAG_INDEX_PATH, null);
const candidates = Array.isArray(store.candidates) ? store.candidates : [];
const counts = countStatuses(candidates);
const typeCounts = countTypes(candidates);

renderStatus();

function renderStatus() {
  console.log('Sophia knowledge status');
  console.log(`Fecha: ${new Date().toISOString()}`);
  console.log('');

  console.log('Archivos');
  console.log('--------');
  printFileStatus('Candidatos', STORE_PATH, store.updatedAt);
  printFileStatus('Indice RAG', RAG_INDEX_PATH, ragIndex?.generatedAt);
  printFileStatus('Ultimo borrador', EXPORT_PATH);
  printFileStatus('Ultimo reporte', REPORT_PATH);
  printFileStatus('Auditoria revision', AUDIT_PATH);
  console.log('');

  console.log('Candidatos');
  console.log('----------');
  console.log(`Total: ${candidates.length}`);
  console.log(`Pendientes: ${counts.pending_review}`);
  console.log(`Aprobados sin aplicar: ${counts.approved}`);
  console.log(`Aplicados al conocimiento: ${counts.applied_to_knowledge}`);
  console.log(`Descartados: ${counts.rejected}`);
  console.log(`Otros estados: ${counts.other}`);
  console.log('');

  console.log('Por tipo');
  console.log('--------');
  if (Object.keys(typeCounts).length === 0) {
    console.log('Sin candidatos registrados.');
  } else {
    for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`${type}: ${count}`);
    }
  }
  console.log('');

  const next = getNextAction(counts);
  console.log('Proxima accion sugerida');
  console.log('-----------------------');
  console.log(next.summary);
  for (const command of next.commands) {
    console.log(`  ${command}`);
  }
}

function readJsonFile(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      ...fallback,
      readError: error.message
    };
  }
}

function countStatuses(items) {
  const counts = {
    pending_review: 0,
    approved: 0,
    applied_to_knowledge: 0,
    rejected: 0,
    other: 0
  };

  for (const item of items) {
    if (Object.prototype.hasOwnProperty.call(counts, item.status)) {
      counts[item.status] += 1;
    } else {
      counts.other += 1;
    }
  }

  return counts;
}

function countTypes(items) {
  return items.reduce((acc, item) => {
    const type = item.type || 'unknown';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
}

function printFileStatus(label, path, logicalTimestamp) {
  if (!existsSync(path)) {
    console.log(`${label}: no encontrado (${relativePath(path)})`);
    return;
  }

  const stat = statSync(path);
  const details = [
    relativePath(path),
    `size=${formatBytes(stat.size)}`,
    `mtime=${stat.mtime.toISOString()}`
  ];
  if (logicalTimestamp) details.push(`timestamp=${logicalTimestamp}`);
  console.log(`${label}: ${details.join(' | ')}`);
}

function getNextAction(counts) {
  if (counts.pending_review > 0) {
    return {
      summary: `Revisar ${counts.pending_review} candidato(s) pendiente(s).`,
      commands: [
        'npm run knowledge:review',
        'npm run knowledge:review -- --id kc_xxxxx',
        'npm run knowledge:review -- --approve kc_xxxxx'
      ]
    };
  }

  if (counts.approved > 0) {
    return {
      summary: `Exportar ${counts.approved} candidato(s) aprobado(s) y aplicar los validos en knowledge/.`,
      commands: [
        'npm run knowledge:export',
        'nano knowledge/<archivo>.md',
        'npm run rag:ingest',
        'npm run knowledge:review -- --applied kc_xxxxx --target knowledge/<archivo>.md'
      ]
    };
  }

  return {
    summary: 'No hay pendientes ni aprobados sin aplicar. Genera candidatos nuevos cuando haya actividad suficiente.',
    commands: [
      'npm run knowledge:candidates',
      'npm run knowledge:candidates:report',
      'npm run knowledge:status'
    ]
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'n/a';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function relativePath(path) {
  return path.replace(`${process.cwd()}/`, '');
}
