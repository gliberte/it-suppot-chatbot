import 'dotenv/config';
import { AgentOrchestrator } from '../agent-orchestrator.js';

const ONLY = getArgValue('--only');
const REPEAT = Number(getArgValue('--repeat') || 1);

if (!process.env.GEMINI_API_KEY) {
  console.error('Falta GEMINI_API_KEY para ejecutar el eval del agente.');
  process.exit(1);
}

const USER_NORMAL = {
  name: 'Ana Diaz',
  email: 'ana.diaz@bacosa.com',
  department: 'Ventas',
  sdpRequesterId: '5001',
  role: 'user'
};

const USER_ADMIN = {
  name: 'Luis Solano',
  email: 'luis.solano@bacosa.com',
  department: 'IT',
  sdpRequesterId: '7210',
  role: 'support_admin'
};

const BARRAZA_BRANDS_KNOWLEDGE = [
  '--- empresa-barraza-marcas.md (score=0.81) ---',
  'Barraza & Cía, S.A. maneja las marcas Sip, Spum, 10, Romeo, Rocío, 4D, Julieta, Americano, Sip Bebé y Sip EcoGreen, distribuidas en las líneas Hogar e Institucional.'
].join('\n');

// Cada caso describe un mensaje real de usuario y lo que agent-orchestrator.js
// (vía Gemini) debe decidir. No valida el resultado final de la herramienta
// contra SDP/SAP -- eso ya lo hacen los tests de lib/authz.js y el uso real --
// sino que la IA elija la acción/herramienta/argumentos correctos para no
// romper el comportamiento existente cuando cambie el SYSTEM_PROMPT o el modelo.
const cases = [
  {
    name: 'Saludo simple no debe usar herramientas',
    message: 'Hola Sophia, buenos días',
    user: USER_NORMAL,
    expect: { action: 'reply' }
  },
  {
    name: 'Agradecimiento tras auto-solución no crea ticket',
    message: 'Gracias, ya funcionó, era el cable de red',
    user: USER_NORMAL,
    history: [
      { role: 'user', content: 'mi laptop no tiene internet' },
      { role: 'assistant', content: 'Prueba revisar el cable de red y reiniciar el switch más cercano.' }
    ],
    expect: { action: 'reply', contentExcludesAny: ['#'] }
  },
  {
    name: 'Usuario normal pide sus tickets abiertos',
    message: '¿Cuáles son mis tickets abiertos?',
    user: USER_NORMAL,
    expect: {
      action: 'call_tool',
      toolName: 'sdp_list_requests',
      argsContains: { filter_by: 'Open_Requests' }
    }
  },
  {
    name: 'Usuario normal pide sus MCI',
    message: 'Quiero ver mis MCI',
    user: USER_NORMAL,
    expect: {
      action: 'call_tool',
      toolName: 'sdp_list_requests',
      argsContains: { mci_only: true }
    }
  },
  {
    name: 'Admin pide MCI de un líder específico',
    message: 'Muéstrame las MCI de Kassim Acevedo y sus porcentajes de avance',
    user: USER_ADMIN,
    expect: {
      action: 'call_tool',
      toolName: 'sdp_list_requests',
      argsContains: { mci_only: true, mci_leader_name: 'Kassim' }
    }
  },
  {
    name: 'Admin pide tickets de una persona sin aclarar rol -> debe preguntar',
    message: 'Dime los tickets de Purificación',
    user: USER_ADMIN,
    expect: {
      action: 'reply',
      contentIncludesAny: ['solicitante', 'técnico', 'tecnico']
    }
  },
  {
    name: 'Admin pide tickets por técnico asignado explícito',
    message: 'Tickets asignados al técnico Purificación',
    user: USER_ADMIN,
    expect: {
      action: 'call_tool',
      toolName: 'sdp_list_requests',
      argsContains: { assigned_technician_name: 'Purificación' }
    }
  },
  {
    name: 'Reporte de falla nuevo: primer turno propone redacción, no crea ticket',
    message: 'No puedo acceder a SAP, me sale usuario o contraseña incorrectos',
    user: USER_NORMAL,
    expect: {
      action: 'reply',
      contentIncludesAny: ['Asunto', 'asunto']
    }
  },
  {
    name: 'Confirmación de redacción ya propuesta crea la solicitud',
    message: 'Está bien, así procede, créalo',
    user: USER_NORMAL,
    history: [
      { role: 'user', content: 'No puedo acceder a SAP, me sale usuario o contraseña incorrectos' },
      {
        role: 'assistant',
        content: 'Te comparto la propuesta de redacción para la solicitud:\n\n**Asunto:** No puedo acceder a SAP\n\n**Descripción:**\n📌 **Problema o Solicitud**:\nNo puede iniciar sesión en SAP, el sistema indica usuario o contraseña incorrectos.\n\n¿Te sirvió alguno de estos pasos o deseas ajustar la redacción antes de generar la tarjeta de confirmación final?'
      }
    ],
    expect: {
      action: 'call_tool',
      toolName: 'sdp_create_request',
      argsPresent: ['subject', 'description']
    }
  },
  {
    name: 'Cuenta de AD bloqueada usa automatización directa',
    message: 'Me bloquearon mi cuenta de AD, no puedo iniciar sesión en ningún equipo',
    user: USER_NORMAL,
    expect: {
      action: 'call_tool',
      toolName: 'sdp_execute_automation_action',
      argsContains: { action_type: 'UNLOCK_ACCOUNT' }
    }
  },
  {
    name: 'Agregar nota con ID y texto explícitos ejecuta sdp_add_note directo',
    message: 'Agrega esta nota al ticket 12345: ya se resolvió reiniciando el switch',
    user: USER_NORMAL,
    expect: {
      action: 'call_tool',
      toolName: 'sdp_add_note',
      argsContains: { request_id: '12345' },
      argsPresent: ['note_text']
    }
  },
  {
    name: 'Agregar nota usando memoria del último ticket',
    message: 'Agrega una nota a ese ticket: el usuario confirmó que ya funciona',
    user: USER_NORMAL,
    operationalMemory: {
      lastTicket: {
        id: '54321',
        subject: 'Switch de red caído',
        status: 'En Proceso',
        priority: 'Media',
        requester: 'Ana Diaz',
        technician: 'Kassim Acevedo',
        source: 'sdp_create_request',
        updatedAt: new Date().toISOString()
      },
      lastTicketList: null
    },
    expect: {
      action: 'call_tool',
      toolName: 'sdp_add_note',
      argsContains: { request_id: '54321' }
    }
  },
  {
    name: 'Pregunta de marcas de Barraza usa el conocimiento recuperado',
    message: '¿Qué marcas maneja Barraza?',
    user: USER_NORMAL,
    ragContext: BARRAZA_BRANDS_KNOWLEDGE,
    expect: {
      action: 'reply',
      contentExcludesAny: ['no manejo información de negocio', 'no tengo información']
    }
  },
  {
    name: 'Pedido de gráfica de MCI ejecuta la herramienta en silencio',
    message: 'Hazme una gráfica del avance de mis MCI',
    user: USER_NORMAL,
    expect: {
      action: 'call_tool',
      toolName: 'sdp_list_requests',
      argsContains: { mci_only: true }
    }
  },
  {
    name: 'Actualizar avance de una MCI con ID real',
    message: 'Actualiza el avance de la MCI 9988 a 75%',
    user: USER_NORMAL,
    expect: {
      action: 'call_tool',
      toolName: 'sdp_update_mci',
      argsContains: { request_id: '9988' },
      argsPresent: ['fields']
    }
  },
  {
    name: 'Falta información crítica -> Sophia debe preguntar, no adivinar',
    message: 'Agrega una nota a un ticket',
    user: USER_NORMAL,
    expect: { action: 'reply' }
  },
  {
    name: 'Técnico asignado pide cambiar el estado de su ticket',
    message: 'Marca el ticket 15200 como Resuelto',
    user: USER_NORMAL,
    expect: {
      action: 'call_tool',
      toolName: 'sdp_update_request',
      argsContains: { request_id: '15200', status: 'Resuelto' }
    }
  },
  {
    // Bug real de producción: este mensaje se enrutaba a sdp_add_note (por la palabra
    // "comentario"), perdiendo el cambio de estado que también se pidió explícitamente.
    name: 'Cambio de estado con comentario en el mismo mensaje -> una sola acción sdp_update_request',
    message: 'Coloca el ticket 13738 en estado de en espera y colócale el siguiente comentario: Personal ingresa en el turno 3 de 10:00 p.m a 6:00., la Ing. Mirentxu tratará de comunicarle que llegue antes de mi hora de salida.',
    user: USER_NORMAL,
    expect: {
      action: 'call_tool',
      toolName: 'sdp_update_request',
      argsContains: { request_id: '13738', status: 'En Espera' },
      customCheck: (toolArgs) => {
        const comments = String(toolArgs?.comments || '');
        return comments.toLowerCase().includes('turno 3')
          ? null
          : `tool_args.comments no incluyó el texto del comentario pedido (comments="${comments}")`;
      }
    }
  },
  {
    // Bug real de producción: sdp_resolve_request nunca estuvo en el catálogo de la IA, así
    // que Sophia nunca la elegía para agregar la resolución de un ticket.
    name: 'Técnico pide agregar la resolución de su ticket',
    message: 'Agrega esta resolución al ticket 13738: Se reemplazó el cable de red y se validó conectividad con el usuario.',
    user: USER_NORMAL,
    expect: {
      action: 'call_tool',
      toolName: 'sdp_resolve_request',
      argsContains: { request_id: '13738' },
      customCheck: (toolArgs) => {
        const resolutionText = String(toolArgs?.resolution_text || '');
        return resolutionText.toLowerCase().includes('cable de red')
          ? null
          : `tool_args.resolution_text no incluyó el texto de la resolución pedido (resolution_text="${resolutionText}")`;
      }
    }
  },
  {
    name: 'Consulta SAP HANA califica el esquema obligatorio',
    message: '¿Cuántas facturas se generaron este mes en SAP?',
    user: USER_ADMIN,
    expect: {
      action: 'call_tool',
      toolName: 'sap_hana_query',
      customCheck: (toolArgs) => {
        const sql = String(toolArgs?.query || toolArgs?.sqlQuery || toolArgs?.sql || toolArgs?.sql_query || '');
        return sql.includes('C2910638_BARCIA_PRD')
          ? null
          : `la consulta SQL no calificó el esquema obligatorio C2910638_BARCIA_PRD: ${sql.slice(0, 200)}`;
      }
    }
  },
  {
    name: 'Error genérico de Windows usa búsqueda web de soporte',
    message: 'Me sale el error de Windows 0x80070005 al instalar una actualización',
    user: USER_NORMAL,
    expect: {
      action: 'call_tool',
      toolName: 'web_search_support',
      argsPresent: ['query']
    }
  },
  {
    name: 'Sistema interno (Barraza Móvil) NO debe usar búsqueda web',
    message: 'No puedo iniciar sesión en Barraza Móvil desde mi teléfono',
    user: USER_NORMAL,
    expect: { toolNameNot: 'web_search_support' }
  }
];

let totalCases = 0;
let totalRuns = 0;
let totalFailures = 0;
const caseFailures = [];

for (const testCase of filterCases(cases, ONLY)) {
  totalCases += 1;
  let passRuns = 0;

  for (let attempt = 1; attempt <= REPEAT; attempt += 1) {
    totalRuns += 1;
    const context = {
      user: testCase.user,
      operationalMemory: testCase.operationalMemory || null,
      ragContext: testCase.ragContext || null
    };

    const result = await AgentOrchestrator.processMessage(testCase.message, context, testCase.history || []);
    const failureReasons = evaluate(result, testCase.expect);

    if (failureReasons.length === 0) {
      passRuns += 1;
    } else {
      totalFailures += 1;
      caseFailures.push({ name: testCase.name, attempt, result, failureReasons });
    }
  }

  const label = REPEAT > 1 ? `${passRuns}/${REPEAT}` : (passRuns === REPEAT ? 'PASS' : 'FAIL');
  console.log(`${passRuns === REPEAT ? 'PASS' : 'FAIL'} [${label}] ${testCase.name}`);
  console.log(`  mensaje: "${testCase.message}"`);
}

if (caseFailures.length > 0) {
  console.log('\nDetalle de fallas:');
  for (const failure of caseFailures) {
    const attemptLabel = REPEAT > 1 ? ` (intento ${failure.attempt})` : '';
    console.log(`\n- ${failure.name}${attemptLabel}`);
    console.log(`  decisión real: action=${failure.result.action} tool_name=${failure.result.tool_name || '-'}`);
    console.log(`  tool_args: ${JSON.stringify(failure.result.tool_args || {})}`);
    console.log(`  content: ${String(failure.result.content || '').slice(0, 200)}`);
    for (const reason of failure.failureReasons) {
      console.log(`  ✗ ${reason}`);
    }
  }
}

const passedRuns = totalRuns - totalFailures;
console.log(`\n${passedRuns}/${totalRuns} ejecuciones pasaron (${totalCases} caso(s), ${REPEAT} intento(s) c/u).`);

if (totalFailures > 0) {
  process.exit(1);
}

function evaluate(result, expect = {}) {
  const reasons = [];
  const toolArgs = result?.tool_args || {};

  if (expect.action && result?.action !== expect.action) {
    reasons.push(`action esperado="${expect.action}" recibido="${result?.action}"`);
  }

  if (expect.toolName && result?.tool_name !== expect.toolName) {
    reasons.push(`tool_name esperado="${expect.toolName}" recibido="${result?.tool_name}"`);
  }

  if (expect.toolNameNot && result?.tool_name === expect.toolNameNot) {
    reasons.push(`tool_name no debía ser "${expect.toolNameNot}"`);
  }

  if (expect.argsContains) {
    for (const [key, expectedValue] of Object.entries(expect.argsContains)) {
      const actualValue = toolArgs[key];
      if (typeof expectedValue === 'boolean') {
        if (actualValue !== expectedValue) {
          reasons.push(`tool_args.${key} esperado=${expectedValue} recibido=${JSON.stringify(actualValue)}`);
        }
      } else if (typeof expectedValue === 'string') {
        const normalizedActual = normalize(String(actualValue ?? ''));
        const normalizedExpected = normalize(expectedValue);
        if (!normalizedActual.includes(normalizedExpected)) {
          reasons.push(`tool_args.${key} debía incluir "${expectedValue}", recibido=${JSON.stringify(actualValue)}`);
        }
      }
    }
  }

  if (expect.argsPresent) {
    for (const key of expect.argsPresent) {
      const value = toolArgs[key];
      if (value === undefined || value === null || value === '') {
        reasons.push(`tool_args.${key} debía estar presente y no vacío`);
      }
    }
  }

  if (expect.contentIncludesAny) {
    const content = normalize(String(result?.content || ''));
    const found = expect.contentIncludesAny.some((term) => content.includes(normalize(term)));
    if (!found) {
      reasons.push(`content debía incluir alguno de: ${expect.contentIncludesAny.join(' | ')}`);
    }
  }

  if (expect.contentExcludesAny) {
    const content = normalize(String(result?.content || ''));
    const found = expect.contentExcludesAny.find((term) => content.includes(normalize(term)));
    if (found) {
      reasons.push(`content no debía incluir: "${found}"`);
    }
  }

  if (typeof expect.customCheck === 'function') {
    const customFailure = expect.customCheck(toolArgs, result);
    if (customFailure) reasons.push(customFailure);
  }

  return reasons;
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function filterCases(allCases, only) {
  if (!only) return allCases;
  const needle = normalize(only);
  return allCases.filter((testCase) => normalize(testCase.name).includes(needle));
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}
