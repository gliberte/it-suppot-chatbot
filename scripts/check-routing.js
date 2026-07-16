import 'dotenv/config';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { getTicketRoutingMap, normalizeRoutingText, resolveTicketRoutingFromText } from '../ticket-routing.js';

const HISTORY_PATH = resolve(process.env.SDP_TICKET_HISTORY_PATH || '../sdp-mcp-server/ticket_history.json');
const REPORT_PATH = resolve(process.env.SDP_CATALOG_REPORT_PATH || 'reports/sdp-catalog-report-2026-07-01.md');

const catalog = buildCatalogIndex();
const routes = getTicketRoutingMap();
const results = routes.map(validateRoute);
const behaviorResults = validateRoutingBehavior();
const failures = results.filter((result) => result.status === 'FAIL');
const behaviorFailures = behaviorResults.filter((result) => result.status === 'FAIL');
const warnings = results.filter((result) => result.status === 'WARN');

console.log(renderResults(results));
console.log(`\n${renderBehaviorResults(behaviorResults)}`);

if (warnings.length) {
  console.log(`\n${warnings.length} advertencia(s).`);
}

if (failures.length || behaviorFailures.length) {
  console.error(`\n${failures.length} ruta(s) inválida(s), ${behaviorFailures.length} comportamiento(s) inválido(s).`);
  process.exit(1);
}

console.log(`\nTodas las rutas obligatorias son válidas (${results.length - warnings.length}/${results.length}) y los ejemplos de clasificación pasaron (${behaviorResults.length}/${behaviorResults.length}).`);

function validateRoutingBehavior() {
  const cases = [
    {
      text: 'Falla de Internet - Lentitud',
      expectedRoute: 'internet_slow'
    },
    {
      text: 'No tengo internet',
      expectedRoute: 'internet_access'
    },
    {
      text: 'Crea un ticket porque mi mouse no funciona',
      expectedRoute: 'peripheral_mouse'
    },
    {
      text: 'Crea un ticket porque mis audífonos no funcionan',
      expectedRoute: 'peripheral_audio'
    },
    {
      text: 'Falla de monitor con líneas en la pantalla',
      expectedRoute: 'computer_monitor'
    },
    {
      text: 'Reporte de celular corporativo dañado',
      expectedRoute: 'mobile_device'
    },
    {
      text: 'Barraza Móvil no sincroniza rutas asignadas ni cobertura de ventas',
      expectedRoute: 'mobile_device'
    },
    {
      text: 'No puedo acceder a SAP',
      expectedRoute: 'sap_access'
    },
    {
      text: 'Necesito modificar una consulta de usuario SAP para informe de devolución por clientes y producción por lote',
      expectedRoute: 'sap_reporting'
    },
    {
      text: 'Solicitar creación y asignación del subdominio sophia.bacosa.com para un servidor virtual. Prioridad alta.',
      expectedRoute: 'web_hosting_dns'
    },
    {
      text: 'Impresora Zebra con papel atascado',
      expectedRoute: 'printer'
    },
    {
      text: 'Laptop lenta',
      expectedRoute: 'default'
    }
  ];

  return cases.map((testCase) => {
    const match = resolveTicketRoutingFromText(testCase.text);
    const routeName = match.name || 'default';
    return {
      ...testCase,
      routeName,
      status: routeName === testCase.expectedRoute ? 'PASS' : 'FAIL',
      matchedKeywords: match.matchedKeywords || []
    };
  });
}

function buildCatalogIndex() {
  const categories = new Set();
  const subcategoriesByCategory = new Map();
  const sources = [];

  if (existsSync(REPORT_PATH)) {
    sources.push(REPORT_PATH);
    for (const category of readCategoriesFromReport(REPORT_PATH)) {
      categories.add(normalizeCatalogValue(category));
    }
  }

  if (existsSync(HISTORY_PATH)) {
    sources.push(HISTORY_PATH);
    const history = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
    visitRequests(history, (request) => {
      const category = getDisplayName(request.category);
      const subcategory = getDisplayName(request.subcategory);
      if (!category) return;
      const normalizedCategory = normalizeCatalogValue(category);
      categories.add(normalizedCategory);
      if (!subcategory) return;
      if (!subcategoriesByCategory.has(normalizedCategory)) {
        subcategoriesByCategory.set(normalizedCategory, new Set());
      }
      subcategoriesByCategory.get(normalizedCategory).add(normalizeCatalogValue(subcategory));
    });
  }

  return { categories, subcategoriesByCategory, sources };
}

function validateRoute(route) {
  const category = normalizeCatalogValue(route.category);
  const subcategory = normalizeCatalogValue(route.subcategory);

  if (!category) {
    return {
      status: 'FAIL',
      route,
      message: 'No tiene categoría configurada.'
    };
  }

  if (!catalog.categories.has(category)) {
    return {
      status: 'FAIL',
      route,
      message: `La categoría "${route.category}" no aparece en catálogo/histórico local.`
    };
  }

  if (!subcategory || subcategory === 'none') {
    return {
      status: 'WARN',
      route,
      message: 'No tiene subcategoría; SDP puede rechazar si la categoría la exige.'
    };
  }

  const knownSubcategories = catalog.subcategoriesByCategory.get(category);
  if (!knownSubcategories?.size) {
    return {
      status: 'WARN',
      route,
      message: `No hay histórico local suficiente para validar subcategorías de "${route.category}".`
    };
  }

  if (!knownSubcategories.has(subcategory)) {
    return {
      status: 'FAIL',
      route,
      message: `La subcategoría "${route.subcategory}" no aparece bajo "${route.category}". Candidatas: ${sampleValues(knownSubcategories)}.`
    };
  }

  return {
    status: 'PASS',
    route,
    message: 'Categoría y subcategoría observadas en catálogo/histórico.'
  };
}

function readCategoriesFromReport(reportPath) {
  const content = readFileSync(reportPath, 'utf8');
  const categories = [];
  for (const line of content.split('\n')) {
    const match = line.match(/^\|\s*\d+\s*\|\s*([^|]+?)\s*\|$/);
    if (match?.[1] && !['ID', 'Categoria'].includes(match[1].trim())) {
      categories.push(match[1].trim());
    }
  }
  return categories;
}

function visitRequests(value, callback) {
  if (Array.isArray(value)) {
    value.forEach((item) => visitRequests(item, callback));
    return;
  }

  if (!value || typeof value !== 'object') return;

  if (value.category || value.subcategory || value.subject || value.id) {
    callback(value);
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') visitRequests(child, callback);
  }
}

function getDisplayName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.name || value.display_value || value.value || '';
}

function normalizeCatalogValue(value) {
  return normalizeRoutingText(value)
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sampleValues(values) {
  return [...values].slice(0, 10).join(', ') || 'sin candidatas';
}

function renderResults(results) {
  const columns = [
    ['status', 'Estado'],
    ['name', 'Ruta'],
    ['category', 'Categoría'],
    ['subcategory', 'Subcategoría'],
    ['message', 'Validación']
  ];
  const rows = results.map((result) => ({
    status: result.status,
    name: result.route.name,
    category: result.route.category || '',
    subcategory: result.route.subcategory || '',
    message: result.message
  }));
  const widths = Object.fromEntries(columns.map(([key, label]) => [
    key,
    Math.max(label.length, ...rows.map((row) => truncate(String(row[key] || ''), key === 'message' ? 80 : 24).length))
  ]));
  const header = columns.map(([key, label]) => label.padEnd(widths[key])).join('  ');
  const separator = columns.map(([key]) => '-'.repeat(widths[key])).join('  ');
  const body = rows.map((row) => columns
    .map(([key]) => truncate(String(row[key] || ''), key === 'message' ? 80 : 24).padEnd(widths[key]))
    .join('  '));
  return [header, separator, ...body].join('\n');
}

function renderBehaviorResults(results) {
  const columns = [
    ['status', 'Estado'],
    ['text', 'Ejemplo'],
    ['expectedRoute', 'Esperado'],
    ['routeName', 'Obtenido'],
    ['matchedKeywords', 'Señales']
  ];
  const rows = results.map((result) => ({
    ...result,
    matchedKeywords: result.matchedKeywords.join(', ') || '-'
  }));
  const widths = Object.fromEntries(columns.map(([key, label]) => [
    key,
    Math.max(label.length, ...rows.map((row) => truncate(String(row[key] || ''), key === 'text' ? 40 : 24).length))
  ]));
  const header = columns.map(([key, label]) => label.padEnd(widths[key])).join('  ');
  const separator = columns.map(([key]) => '-'.repeat(widths[key])).join('  ');
  const body = rows.map((row) => columns
    .map(([key]) => truncate(String(row[key] || ''), key === 'text' ? 40 : 24).padEnd(widths[key]))
    .join('  '));
  return [header, separator, ...body].join('\n');
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}
