import 'dotenv/config';
import { existsSync } from 'fs';
import { searchKnowledge } from '../rag.js';

const MIN_SCORE = Number(process.env.RAG_TEST_MIN_SCORE || 0.3);
const LIMIT = Number(process.env.RAG_TEST_LIMIT || 5);

const cases = [
  {
    name: 'SAP reportería y consultas de usuario',
    query: 'crear ticket para consulta de usuario SAP producción por lote informe de devolución',
    role: 'user',
    expectedArea: 'sdp',
    requireTopArea: true,
    expectedTerms: ['SAP / Reportería', 'Consultas de Usuario']
  },
  {
    name: 'Acceso SAP',
    query: 'usuario no puede acceder a SAP por contraseña bloqueada',
    role: 'user',
    expectedArea: 'sdp',
    expectedTerms: ['Contraseñas / SAP', 'login']
  },
  {
    name: 'Impresora Zebra',
    query: 'impresora Zebra con papel atascado no imprime etiquetas',
    role: 'user',
    expectedArea: 'sdp',
    expectedTerms: ['Impresoras / Zebra Etiquetas', 'Zebra']
  },
  {
    name: 'Impresora HP',
    query: 'crear ticket para soporte de impresora HP de la oficina',
    role: 'user',
    expectedArea: 'sdp',
    expectedTerms: ['Impresoras / HP', 'HP']
  },
  {
    name: 'Mudanzas de equipo',
    query: 'solicito traslado de mi computadora de escritorio y monitor a mi nuevo puesto de trabajo',
    role: 'user',
    expectedArea: 'sdp',
    expectedTerms: ['Mudanzas']
  },
  {
    name: 'Suministros de oficina',
    query: 'necesito pedir un nuevo cartucho de toner de tinta para la impresora de recepcion',
    role: 'user',
    expectedArea: 'sdp',
    expectedTerms: ['Suministros / Tintas', 'tinta']
  },
  {
    name: 'Celular corporativo dañado',
    query: 'crear ticket por celular corporativo dañado pantalla rota',
    role: 'user',
    expectedArea: 'sdp',
    expectedTerms: ['Teléfonos / Celulares', 'pantalla rota']
  },
  {
    name: 'Microsoft 365 y Correo',
    query: 'crear ticket porque Outlook no sincroniza mis correos',
    role: 'user',
    expectedArea: 'sdp',
    expectedTerms: ['Correo', 'Outlook']
  },
  {
    name: 'Mouse y periféricos',
    query: 'crear ticket por falla de mouse no funciona correctamente',
    role: 'user',
    expectedArea: 'soporte',
    requireTopArea: true,
    expectedTerms: ['accesorio', 'puerto']
  },
  {
    name: 'Audífonos y headset',
    query: 'crear ticket porque mis audífonos no funcionan',
    role: 'user',
    expectedArea: 'soporte',
    requireTopArea: true,
    expectedTerms: ['accesorio', 'puerto']
  },
  {
    name: 'MCI no debe mezclar tickets normales',
    query: 'quiero ver mis MCI',
    role: 'user',
    expectedArea: 'mci',
    requireTopArea: true,
    expectedTerms: ['mci_only=true', 'PlantMCI']
  },
  {
    name: 'MCI por líder',
    query: 'muéstrame las MCI de Kassim Acevedo y sus porcentajes de avance',
    role: 'support_admin',
    expectedArea: 'mci',
    requireTopArea: true,
    expectedTerms: ['Líder de MCI', 'mci_leader_name', 'udf_pick_1503', 'udf_long_1801', 'udf_sline_2102']
  },
  {
    name: 'Admin técnico asignado',
    query: 'tickets de Purificación como técnico asignado',
    role: 'support_admin',
    expectedArea: 'admin',
    requireTopArea: true,
    expectedTerms: ['assigned_technician_name', 'udf_pick_2701']
  },
  {
    name: 'Admin debe aclarar persona ambigua',
    query: 'dime los tickets de Purificación',
    role: 'support_admin',
    expectedArea: 'admin',
    requireTopArea: true,
    expectedTerms: ['solicitante', 'Técnico asignado']
  },
  {
    name: 'Estado exacto En Espera',
    query: 'tickets en estado En Espera',
    role: 'support_admin',
    expectedArea: 'admin',
    expectedTerms: ['status: "En Espera"', 'filtros genéricos']
  },
  {
    name: 'Error SDP técnico asignado obligatorio',
    query: 'ServiceDesk Plus pide udf_pick_2701 obligatorio al crear ticket',
    role: 'support_admin',
    expectedArea: 'sdp',
    expectedTerms: ['Técnico asignado', 'SDP_DEFAULT_UDF_PICK_2701', 'No pedir al usuario']
  },
  {
    name: 'Error SDP subcategoría obligatoria mouse',
    query: 'error mandatory subcategory al crear ticket por falla de mouse',
    role: 'support_admin',
    expectedArea: 'sdp',
    expectedTerms: ['Accesorio / Mouse', 'subcategory', 'No pedir al usuario']
  },
  {
    name: 'Seguimientos usan sdp_add_note',
    query: 'agregar seguimiento a ticket falló con fields notes',
    role: 'support_admin',
    expectedArea: 'sdp',
    expectedTerms: ['sdp_add_note', 'note_text', 'No usar `sdp_update_request`']
  }
];

if (!process.env.GEMINI_API_KEY) {
  console.error('Falta GEMINI_API_KEY para ejecutar pruebas RAG.');
  process.exit(1);
}

if (!existsSync(process.env.RAG_INDEX_PATH || 'data/rag-index.json')) {
  console.error('No existe el índice RAG. Ejecuta primero: npm run rag:ingest');
  process.exit(1);
}

let failures = 0;

for (const testCase of cases) {
  const results = await searchKnowledge(testCase.query, {
    role: testCase.role,
    limit: LIMIT,
    minScore: MIN_SCORE
  });

  const top = results[0];
  const content = results.map((result) => result.content).join('\n\n');
  const areaOk = testCase.requireTopArea
    ? top?.area === testCase.expectedArea
    : top?.area === testCase.expectedArea || results.some((result) => result.area === testCase.expectedArea);
  const termsOk = testCase.expectedTerms.every((term) => content.toLowerCase().includes(term.toLowerCase()));
  const passed = Boolean(top) && areaOk && termsOk;

  if (!passed) failures += 1;

  console.log(`${passed ? 'PASS' : 'FAIL'} ${testCase.name}`);
  console.log(`  query: ${testCase.query}`);
  console.log(`  expected area: ${testCase.expectedArea}`);
  console.log(`  top: ${top ? `${top.title} | area=${top.area} | score=${top.score.toFixed(3)} | source=${top.source}` : 'sin resultados'}`);

  if (!termsOk) {
    const missing = testCase.expectedTerms.filter((term) => !content.includes(term));
    console.log(`  missing terms: ${missing.join(', ')}`);
  }

  if (results.length > 1) {
    console.log('  other matches:');
    for (const result of results.slice(1, 3)) {
      console.log(`    - ${result.title} | area=${result.area} | score=${result.score.toFixed(3)}`);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} prueba(s) RAG fallaron.`);
  process.exit(1);
}

console.log(`\nTodas las pruebas RAG pasaron (${cases.length}/${cases.length}).`);
