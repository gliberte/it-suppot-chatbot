import express from 'express';
import cors from 'cors';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from 'dotenv';
import { AgentOrchestrator } from './agent-orchestrator.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { appendFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { CloudAdapter, ConfigurationBotFrameworkAuthentication, TeamsActivityHandler, TurnContext } from 'botbuilder';

dotenv.config();



const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000);
const PENDING_ACTION_TTL_MS = Number(process.env.PENDING_ACTION_TTL_MS || 5 * 60 * 1000);
const GEMINI_SUMMARY_MODEL = process.env.GEMINI_SUMMARY_MODEL || 'gemini-2.5-flash';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash';
const sessions = new Map();
const teamsSessions = new Map();
const teamsUserCache = new Map();
const graphTokenCache = { accessToken: null, expiresAt: 0 };
const READ_ONLY_CHAT_TOOLS = new Set([
  'sdp_list_requests',
  'sdp_get_request_details',
  'sdp_search_user'
]);

const CONFIRMATION_WORDS = new Set(['confirmar', 'confirmo', 'si', 'sí', 'ok', 'dale']);
const CANCEL_WORDS = new Set(['cancelar', 'cancela', 'no']);
const TOOLS_REQUIRING_CONFIRMATION = new Set([
  'sdp_create_request',
  'sdp_add_note',
  'sdp_resolve_request',
  'sdp_assign_request',
  'sdp_update_request',
  'sdp_execute_automation_action'
]);
const REQUEST_SCOPED_MUTATION_TOOLS = new Set([
  'sdp_add_note',
  'sdp_resolve_request',
  'sdp_assign_request',
  'sdp_update_request',
  'sdp_execute_automation_action'
]);

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

const PORT = 3001;

// Configuración del transporte para conectar con el servidor MCP de SDP
const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(__dirname, "../sdp-mcp-server/build/index.js")],
  env: process.env
});

const mcpClient = new Client(
  { name: "chatbot-bridge", version: "1.0.0" },
  { capabilities: {} }
);

async function initMCP() {
  try {
    await mcpClient.connect(transport);
    console.log("Chatbot Bridge conectado al servidor MCP de ServiceDesk Plus");
  } catch (error) {
    console.error("Error conectando a MCP:", error);
  }
}

function getBearerToken(req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : null;
}

function getSessionForRequest(req) {
  const token = getBearerToken(req);
  const session = token ? sessions.get(token) : null;

  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }

  return { token, session };
}

function requireAuth(req, res, next) {
  const auth = getSessionForRequest(req);

  if (!auth) {
    return res.status(401).json({ success: false, message: 'Sesión expirada o inválida.' });
  }

  req.sessionToken = auth.token;
  req.session = auth.session;
  req.user = auth.session.user;
  next();
}

async function callMcpTool(name, args = {}) {
  const result = await mcpClient.request(
    {
      method: "tools/call",
      params: { name, arguments: args },
    },
    CallToolResultSchema
  );

  if (result.isError) {
    throw new Error(result.content?.[0]?.text || `Error ejecutando ${name}`);
  }

  return result;
}

async function enrichUserWithSdp(user) {
  if (!user?.email && !user?.name) return user;

  const overrides = parseRequesterOverrides();
  const override = user.email ? overrides[user.email.toLowerCase()] : null;
  if (override) {
    return {
      ...user,
      id: override.id || override,
      sdpRequesterId: override.id || override,
      name: override.name || user.name
    };
  }

  try {
    const searches = [user.email, user.name].filter(Boolean);
    let sdpUsers = [];

    for (const searchText of searches) {
      const result = await callMcpTool('sdp_search_user', { search_text: searchText });
      const data = JSON.parse(result.content[0].text);
      sdpUsers = extractSdpUsers(data);
      if (sdpUsers.length > 0) break;
    }

    const userEmail = user.email?.toLowerCase();
    const userName = user.name?.toLowerCase();
    const match = sdpUsers.find((candidate) => {
      const email = candidate.email_id || candidate.email || candidate.mail;
      return userEmail && email?.toLowerCase() === userEmail;
    }) || sdpUsers.find((candidate) => {
      return userName && candidate.name?.toLowerCase() === userName;
    }) || sdpUsers[0];

    if (!match) return user;

    return {
      ...user,
      id: match.id || user.id,
      sdpRequesterId: match.id || user.sdpRequesterId
    };
  } catch (error) {
    console.warn('[Auth] No se pudo enriquecer usuario con SDP:', error.message);
    return user;
  }
}

function extractSdpUsers(data) {
  const users = [];
  const visit = (value, key = '') => {
    if (!value) return;
    if (Array.isArray(value)) {
      if (key === 'users' || key === 'requesters') {
        users.push(...value.filter((item) => item && typeof item === 'object' && item.id));
      }
      value.forEach((item) => visit(item));
      return;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
    }
  };

  visit(data);
  return users;
}

function parseRequesterOverrides() {
  if (!process.env.SDP_REQUESTER_OVERRIDES) return {};

  try {
    return JSON.parse(process.env.SDP_REQUESTER_OVERRIDES);
  } catch (error) {
    console.warn('[Auth] SDP_REQUESTER_OVERRIDES no es JSON válido:', error.message);
    return {};
  }
}

function createSession(user) {
  const token = randomUUID();
  sessions.set(token, {
    user,
    expiresAt: Date.now() + SESSION_TTL_MS,
    pendingActions: new Map()
  });
  return token;
}

function getRequesterId(user) {
  return user?.sdpRequesterId || user?.id;
}

function userCanAccessRequest(user, data) {
  const request = data?.request || data;
  const requester = request?.requester || {};
  const requesterId = String(requester.id || '');
  const requesterEmail = (requester.email_id || requester.email || '').toLowerCase();
  const userRequesterId = String(getRequesterId(user) || '');
  const userEmail = (user?.email || '').toLowerCase();

  return Boolean(
    (userRequesterId && requesterId && userRequesterId === requesterId) ||
    (userEmail && requesterEmail && userEmail === requesterEmail)
  );
}

async function auditToolCall({ user, toolName, args, outcome }) {
  const record = {
    timestamp: new Date().toISOString(),
    user: {
      name: user?.name,
      email: user?.email,
      sdpRequesterId: user?.sdpRequesterId || user?.id
    },
    toolName,
    args: minimizeAuditArgs(args),
    outcome
  };

  try {
    await appendFile(path.join(__dirname, 'audit.log'), `${JSON.stringify(record)}\n`);
  } catch (error) {
    console.warn('[Audit] No se pudo escribir audit.log:', error.message);
  }
}

async function auditTeamsEvent(activity, outcome, details = {}) {
  if (process.env.TEAMS_AUDIT_ENABLED === 'false') return;

  const record = {
    timestamp: new Date().toISOString(),
    outcome,
    tenantId: activity?.conversation?.tenantId,
    conversationId: activity?.conversation?.id,
    conversationType: activity?.conversation?.conversationType,
    from: {
      aadObjectId: activity?.from?.aadObjectId,
      id: truncateText(activity?.from?.id, 80),
      name: activity?.from?.name
    },
    ...details
  };

  try {
    await appendFile(path.join(__dirname, 'teams-audit.log'), `${JSON.stringify(record)}\n`);
  } catch (error) {
    console.warn('[Teams] No se pudo escribir teams-audit.log:', error.message);
  }
}

function minimizeAuditArgs(args = {}) {
  const allowedKeys = [
    'request_id',
    'subject',
    'category',
    'subcategory',
    'priority',
    'request_type',
    'action_type'
  ];
  const minimized = {};

  for (const key of allowedKeys) {
    if (args[key] !== undefined) {
      minimized[key] = redactSensitiveText(String(args[key]));
    }
  }

  if (args.description) {
    minimized.description_preview = truncateText(redactSensitiveText(args.description), 160);
  }

  if (args.user_email || args.requester_email) {
    minimized.user_email_domain = getEmailDomain(args.user_email || args.requester_email);
  }

  return minimized;
}

function prunePendingActions(session) {
  const now = Date.now();
  for (const [id, action] of session.pendingActions.entries()) {
    if (action.expiresAt <= now) {
      session.pendingActions.delete(id);
    }
  }
}

function createPendingAction(session, { toolName, args, content }) {
  prunePendingActions(session);
  const actionId = randomUUID();
  session.pendingActions.set(actionId, {
    toolName,
    args,
    content,
    expiresAt: Date.now() + PENDING_ACTION_TTL_MS
  });
  return actionId;
}

function takePendingAction(session, actionId) {
  prunePendingActions(session);
  const action = session.pendingActions.get(actionId);
  if (!action) return null;
  session.pendingActions.delete(actionId);
  return action;
}

function prepareToolArgs(toolName, toolArgs, user) {
  const args = { ...(toolArgs || {}) };

  if (toolName === 'sdp_list_requests') {
    const requesterId = getRequesterId(user);
    if (!requesterId) {
      throw new Error('Usuario sin solicitante vinculado en ServiceDesk Plus.');
    }
    args.requester_id = requesterId;
  }

  if (toolName === 'sdp_create_request' && user?.name) {
    args.requester = user.name;
    applyCreateTicketDefaults(args);
  }

  if (toolName === 'sdp_execute_automation_action' && user?.email && !args.user_email) {
    args.user_email = user.email;
  }

  return args;
}

function applyCreateTicketDefaults(args) {
  const routing = resolveTicketRouting(args);
  const hasRouting = Boolean(routing.name);
  args.request_type = process.env.SDP_DEFAULT_REQUEST_TYPE || 'Solicitud';
  args.priority = hasRouting
    ? routing.priority
    : normalizePriority(args.priority) || process.env.SDP_DEFAULT_PRIORITY || 'Media';
  args.category = hasRouting
    ? routing.category
    : args.category || process.env.SDP_DEFAULT_CATEGORY || 'Contraseñas';
  args.subcategory = resolveSubcategoryValue(args, routing, hasRouting);
  args.udf_fields = {
    ...(args.udf_fields || {}),
    udf_pick_2701: args.udf_fields?.udf_pick_2701 || routing.udf_pick_2701 || process.env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
  };
}

function resolveSubcategoryValue(args, routing, hasRouting) {
  const value = hasRouting
    ? routing.subcategory
    : args.subcategory || process.env.SDP_DEFAULT_SUBCATEGORY || 'Usuario Windows';

  if (value === 'NONE' || value === '') return undefined;
  return value;
}

function normalizePriority(priority) {
  if (!priority) return undefined;
  const normalized = String(priority).trim().toLowerCase();
  const aliases = {
    alta: 'Alta',
    high: 'Alta',
    media: 'Media',
    mediana: 'Media',
    medium: 'Media',
    normal: 'Media',
    baja: 'Baja',
    low: 'Baja'
  };
  return aliases[normalized] || priority;
}

function resolveTicketRouting(args) {
  const text = `${args.subject || ''} ${args.description || ''}`.toLowerCase();
  const routingMap = getTicketRoutingMap();
  const match = routingMap.find((route) => {
    return route.keywords.some((keyword) => text.includes(keyword.toLowerCase()));
  });

  return match || {};
}

function getTicketRoutingMap() {
  const fallback = [
    {
      name: 'sap_access',
      keywords: ['no puedo acceder a sap', 'acceso a sap', 'entrar a sap', 'login sap', 'contraseña sap', 'password sap', 'usuario o contraseña'],
      category: process.env.SDP_SAP_ACCESS_CATEGORY || process.env.SDP_PASSWORD_CATEGORY || process.env.SDP_DEFAULT_CATEGORY || 'Contraseñas',
      subcategory: process.env.SDP_SAP_ACCESS_SUBCATEGORY || 'SAP',
      priority: process.env.SDP_SAP_ACCESS_PRIORITY || process.env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: process.env.SDP_SAP_ACCESS_UDF_PICK_2701 || process.env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'sap',
      keywords: ['sap', 'business one', 'b1'],
      category: process.env.SDP_SAP_CATEGORY || 'SAP',
      subcategory: process.env.SDP_SAP_SUBCATEGORY || 'Problemas en Modulos',
      priority: process.env.SDP_SAP_PRIORITY || process.env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: process.env.SDP_SAP_UDF_PICK_2701 || process.env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'network',
      keywords: ['wifi', 'wi-fi', 'red', 'internet', 'vpn'],
      category: process.env.SDP_NETWORK_CATEGORY || process.env.SDP_DEFAULT_CATEGORY || 'Contraseñas',
      subcategory: process.env.SDP_NETWORK_SUBCATEGORY || process.env.SDP_DEFAULT_SUBCATEGORY || 'Usuario Windows',
      priority: process.env.SDP_NETWORK_PRIORITY || process.env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: process.env.SDP_NETWORK_UDF_PICK_2701 || process.env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'printer',
      keywords: ['impresora', 'imprimir', 'etiqueta', 'zebra', 'printer'],
      category: process.env.SDP_PRINTER_CATEGORY || process.env.SDP_DEFAULT_CATEGORY || 'Contraseñas',
      subcategory: process.env.SDP_PRINTER_SUBCATEGORY || 'Honeywell',
      priority: process.env.SDP_PRINTER_PRIORITY || process.env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: process.env.SDP_PRINTER_UDF_PICK_2701 || process.env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'password',
      keywords: ['contraseña', 'clave', 'password', 'bloqueada', 'bloqueado', 'usuario o contraseña'],
      category: process.env.SDP_PASSWORD_CATEGORY || process.env.SDP_DEFAULT_CATEGORY || 'Contraseñas',
      subcategory: process.env.SDP_PASSWORD_SUBCATEGORY || process.env.SDP_DEFAULT_SUBCATEGORY || 'Usuario Windows',
      priority: process.env.SDP_PASSWORD_PRIORITY || process.env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: process.env.SDP_PASSWORD_UDF_PICK_2701 || process.env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    }
  ];

  if (!process.env.SDP_TICKET_ROUTING_MAP) return fallback;

  try {
    const configured = JSON.parse(process.env.SDP_TICKET_ROUTING_MAP);
    return Array.isArray(configured) ? configured : fallback;
  } catch (error) {
    console.warn('[Routing] SDP_TICKET_ROUTING_MAP no es JSON válido:', error.message);
    return fallback;
  }
}

function minimizeToolOutputForGemini(toolOutput) {
  let parsed;
  try {
    parsed = JSON.parse(toolOutput);
  } catch {
    return truncateText(redactSensitiveText(toolOutput), 4000);
  }

  return JSON.stringify(minimizeValue(parsed), null, 2);
}

function minimizeValue(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => minimizeValue(item));
  }

  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? truncateText(redactSensitiveText(value), 500) : value;
  }

  if (value.request) {
    return { request: minimizeRequest(value.request) };
  }

  if (Array.isArray(value.requests)) {
    return {
      response_status: value.response_status,
      list_info: value.list_info,
      requests: value.requests.slice(0, 25).map(minimizeRequest)
    };
  }

  if (Array.isArray(value.users)) {
    return {
      users: value.users.slice(0, 25).map(minimizePerson)
    };
  }

  if (value.status || value.message || value.execution_log) {
    return {
      status: value.status,
      message: redactSensitiveText(value.message || ''),
      execution_log: Array.isArray(value.execution_log)
        ? value.execution_log.map((line) => redactSensitiveText(line))
        : undefined
    };
  }

  const allowed = {};
  for (const [key, childValue] of Object.entries(value)) {
    if (['response_status', 'list_info', 'id', 'name', 'status', 'message'].includes(key)) {
      allowed[key] = minimizeValue(childValue);
    }
  }
  return allowed;
}

function minimizeRequest(request) {
  return {
    id: request.id,
    subject: redactSensitiveText(request.subject || ''),
    status: request.status?.name || request.status,
    priority: request.priority?.name || request.priority,
    category: request.category?.name || request.category,
    subcategory: request.subcategory?.name || request.subcategory,
    request_type: request.request_type?.name || request.request_type,
    requester: minimizePerson(request.requester),
    technician: minimizePerson(request.technician),
    created_time: request.created_time?.display_value || request.created_time,
    due_by_time: request.due_by_time?.display_value || request.due_by_time,
    description: truncateText(redactSensitiveText(stripHtml(request.description || request.short_description || '')), 700),
    resolution: request.resolution?.content
      ? truncateText(redactSensitiveText(stripHtml(request.resolution.content)), 700)
      : undefined
  };
}

function minimizePerson(person) {
  if (!person) return undefined;
  return {
    id: person.id,
    name: person.name,
    email_domain: getEmailDomain(person.email_id || person.email || person.mail),
    department: person.department?.name || person.department
  };
}

function getEmailDomain(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return undefined;
  return email.split('@')[1].toLowerCase();
}

function redactSensitiveText(text) {
  if (!text) return text;
  return String(text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email-redacted]')
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, '[phone-redacted]')
    .replace(/\/api\/v3\/[^\s"')]+/g, '[internal-url-redacted]')
    .replace(/https?:\/\/[^\s"')]+/g, '[url-redacted]');
}

function stripHtml(text) {
  return String(text).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}... [truncated]`;
}

function normalizeChatHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter((entry) => ['user', 'assistant'].includes(entry?.role) && typeof entry?.content === 'string')
    .slice(-8)
    .map((entry) => ({
      role: entry.role,
      content: truncateText(redactSensitiveText(entry.content), 1200)
    }));
}

function pushChatHistory(history, role, content) {
  if (!content) return normalizeChatHistory(history);
  return normalizeChatHistory([
    ...(Array.isArray(history) ? history : []),
    { role, content }
  ]);
}

async function runSupportTurn({
  message,
  user,
  history,
  createPendingActionForUser,
  onStatus,
  onText,
  onConfirmationRequired,
  streamSummary = false
}) {
  onStatus?.('Antigravity está analizando tu solicitud...');

  const aiDecision = await AgentOrchestrator.processMessage(message, { user }, normalizeChatHistory(history));
  console.log(`[Bridge] IA decidió:`, JSON.stringify(aiDecision, null, 2));

  if (aiDecision.action !== 'call_tool') {
    onText(aiDecision.content);
    return;
  }

  if (!READ_ONLY_CHAT_TOOLS.has(aiDecision.tool_name) && !TOOLS_REQUIRING_CONFIRMATION.has(aiDecision.tool_name)) {
    onText('No puedo ejecutar esa herramienta porque no está autorizada para el chat.');
    return;
  }

  let preparedArgs;
  try {
    preparedArgs = prepareToolArgs(aiDecision.tool_name, aiDecision.tool_args || {}, user);
  } catch (error) {
    onText(error.message);
    return;
  }

  if (TOOLS_REQUIRING_CONFIRMATION.has(aiDecision.tool_name)) {
    try {
      await assertToolAllowedForUser(aiDecision.tool_name, preparedArgs, user);
    } catch (error) {
      await auditToolCall({ user, toolName: aiDecision.tool_name, args: preparedArgs, outcome: 'authorization_denied' });
      onText(error.message);
      return;
    }

    const actionId = createPendingActionForUser({
      toolName: aiDecision.tool_name,
      args: preparedArgs,
      content: aiDecision.content
    });
    await auditToolCall({ user, toolName: aiDecision.tool_name, args: preparedArgs, outcome: 'confirmation_required' });
    onText(`${aiDecision.content}\n\nPara proteger tus tickets y accesos, esta acción requiere confirmación explícita antes de ejecutarse.`);
    onConfirmationRequired?.({
      actionId,
      toolName: aiDecision.tool_name,
      expiresInMs: PENDING_ACTION_TTL_MS
    });
    return;
  }

  console.log(`[Bridge] Ejecutando: ${aiDecision.tool_name} con args:`, JSON.stringify(aiDecision.tool_args));
  onStatus?.(`Consultando herramienta: ${aiDecision.tool_name}...`);
  onText(`${aiDecision.content}\n\n`);

  try {
    const toolResult = await callMcpTool(aiDecision.tool_name, preparedArgs);
    await auditToolCall({ user, toolName: aiDecision.tool_name, args: preparedArgs, outcome: 'success' });

    const toolOutput = toolResult.content[0].text;
    if (aiDecision.tool_name === 'sdp_get_request_details') {
      const requestData = JSON.parse(toolOutput);
      if (!userCanAccessRequest(user, requestData)) {
        onText('Encontré ese ticket, pero no pertenece a tu usuario autenticado. Por seguridad no puedo mostrarlo.');
        return;
      }
    }

    console.log(`[Bridge] Resultado técnico obtenido.`);

    if (streamSummary) {
      await streamToolSummary(toolOutput, (type, data) => {
        if (type === 'text_chunk') onText(data.content);
      });
    } else {
      onText(await summarizeToolOutput(toolOutput));
    }
  } catch (error) {
    console.error(`[Bridge] Error crítico ejecutando herramienta ${aiDecision.tool_name}:`, error.message);
    onText(`⚠️ Oye, parece que tuve un problema técnico al intentar usar **${aiDecision.tool_name}**. Intenta de nuevo o valida la conexión con ServiceDesk Plus.`);
  }
}

async function executeConfirmedAction(action, user) {
  await assertToolAllowedForUser(action.toolName, action.args, user);
  const toolResult = await callMcpTool(action.toolName, action.args);
  await auditToolCall({ user, toolName: action.toolName, args: action.args, outcome: 'confirmed_success' });
  return summarizeToolOutput(toolResult.content[0].text);
}

async function streamToolSummary(toolOutput, sendEvent) {
  const minimizedOutput = minimizeToolOutputForGemini(toolOutput);
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  try {
    const model = genAI.getGenerativeModel({
      model: GEMINI_SUMMARY_MODEL,
      systemInstruction: "Eres Antigravity, el agente de soporte IT de Barraza y Cía. Recibirás datos técnicos minimizados y redactados. Resume de forma humana, clara y organizada en Markdown. Si hay varios tickets o elementos estructurados, preséntalos SIEMPRE en una TABLA Markdown con columnas claras (como ID, Asunto, Estado, Prioridad, Técnico, etc.). No inventes emails, teléfonos ni datos personales ausentes. Usa emojis de forma profesional para destacar estados (ej: 🔴 Alta, 🟢 Cerrado, 🔵 Abierto). No uses frases introductorias genéricas como 'Aquí tienes el resumen'."
    });
    const result = await model.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: `Resultado técnico minimizado: ${minimizedOutput}` }] }]
    });
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        sendEvent('text_chunk', { content: chunkText });
      }
    }
  } catch (geminiError) {
    console.warn(`[Bridge] ${GEMINI_SUMMARY_MODEL} fallido en streaming, ejecutando fallback a ${GEMINI_FALLBACK_MODEL}:`, geminiError.message);
    const model = genAI.getGenerativeModel({
      model: GEMINI_FALLBACK_MODEL,
      systemInstruction: "Eres Antigravity, el agente de soporte IT de Barraza y Cía. Recibirás datos técnicos minimizados y redactados. Resume de forma humana, clara y organizada en Markdown. Si hay varios tickets o elementos estructurados, preséntalos SIEMPRE en una TABLA Markdown con columnas claras (como ID, Asunto, Estado, Prioridad, Técnico, etc.). No inventes emails, teléfonos ni datos personales ausentes. Usa emojis de forma profesional para destacar estados (ej: 🔴 Alta, 🟢 Cerrado, 🔵 Abierto). No uses frases introductorias genéricas como 'Aquí tienes el resumen'."
    });
    const result = await model.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: `Resultado técnico minimizado: ${minimizedOutput}` }] }]
    });
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        sendEvent('text_chunk', { content: chunkText });
      }
    }
  }
}

async function summarizeToolOutput(toolOutput) {
  const minimizedOutput = minimizeToolOutputForGemini(toolOutput);
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: GEMINI_SUMMARY_MODEL,
    systemInstruction: "Eres Antigravity, el agente de soporte IT de Barraza y Cía. Recibirás datos técnicos minimizados y redactados. Resume de forma humana, clara y organizada en Markdown. Si hay varios tickets o elementos estructurados, preséntalos SIEMPRE en una TABLA Markdown con columnas claras. No inventes emails, teléfonos ni datos personales ausentes. No uses frases introductorias genéricas."
  });
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: `Resultado técnico minimizado: ${minimizedOutput}` }] }]
  });
  return result.response.text();
}

async function assertToolAllowedForUser(toolName, args, user) {
  if (!REQUEST_SCOPED_MUTATION_TOOLS.has(toolName)) return;

  const requestId = args?.request_id;
  if (!requestId || requestId === 'AUTO') {
    throw new Error('Esta acción requiere un ID de ticket real y verificable.');
  }

  const details = await callMcpTool('sdp_get_request_details', { request_id: requestId });
  const data = JSON.parse(details.content[0].text);
  if (!userCanAccessRequest(user, data)) {
    throw new Error('No tienes permiso para modificar ese ticket.');
  }
}

function parseJsonEnv(name, fallback) {
  if (!process.env[name]) return fallback;

  try {
    return JSON.parse(process.env[name]);
  } catch (error) {
    console.warn(`[Config] ${name} no es JSON válido:`, error.message);
    return fallback;
  }
}

function getTeamsAllowedConversationIds() {
  return (process.env.TEAMS_ALLOWED_CONVERSATION_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function getTeamsUserKey(activity) {
  const aadObjectId = activity?.from?.aadObjectId;
  const fromId = activity?.from?.id;
  return aadObjectId || fromId || activity?.conversation?.id;
}

function getTeamsSessionKey(activity) {
  return `${activity?.conversation?.id || 'conversation'}:${getTeamsUserKey(activity) || 'user'}`;
}

function getTeamsSession(activity, user) {
  const key = getTeamsSessionKey(activity);
  const current = teamsSessions.get(key);

  if (current && current.expiresAt > Date.now()) {
    current.user = user;
    current.expiresAt = Date.now() + SESSION_TTL_MS;
    return current;
  }

  const session = {
    user,
    history: [],
    pendingActions: new Map(),
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  teamsSessions.set(key, session);
  return session;
}

function isGraphUserLookupEnabled() {
  return process.env.TEAMS_GRAPH_USER_LOOKUP === 'true';
}

async function resolveTeamsUser(activity) {
  const cacheKey = getTeamsUserKey(activity);
  const cached = cacheKey ? teamsUserCache.get(cacheKey) : null;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const overrides = parseJsonEnv('TEAMS_USER_OVERRIDES', {});
  const lookupKeys = [
    activity?.from?.aadObjectId,
    activity?.from?.id,
    activity?.from?.userPrincipalName,
    activity?.from?.name?.toLowerCase()
  ].filter(Boolean);

  const override = lookupKeys.map((key) => overrides[key]).find(Boolean);
  if (override) {
    const user = await enrichUserWithSdp({
      id: override.id,
      sdpRequesterId: override.sdpRequesterId || override.id,
      name: override.name || activity?.from?.name,
      email: override.email
    });
    cacheTeamsUser(cacheKey, user);
    return user;
  }

  if (isGraphUserLookupEnabled() && activity?.from?.aadObjectId) {
    const graphUser = await fetchTeamsUserFromGraph(activity.from.aadObjectId);
    if (graphUser) {
      const user = await enrichUserWithSdp({
        name: graphUser.displayName || activity?.from?.name,
        email: graphUser.mail || graphUser.userPrincipalName
      });
      cacheTeamsUser(cacheKey, user);
      return user;
    }
  }

  return null;
}

function cacheTeamsUser(cacheKey, user) {
  if (!cacheKey || !user) return;
  teamsUserCache.set(cacheKey, {
    user,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
}

async function fetchTeamsUserFromGraph(aadObjectId) {
  const tenantId = process.env.AZURE_TENANT_ID || process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID || process.env.MICROSOFT_APP_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET || process.env.MICROSOFT_APP_PASSWORD;

  if (!tenantId || !clientId || !clientSecret) {
    console.warn('[Teams] Graph lookup habilitado, pero faltan AZURE_TENANT_ID/MICROSOFT_APP_ID/MICROSOFT_APP_PASSWORD.');
    return null;
  }

  try {
    const accessToken = await getGraphAccessToken({ tenantId, clientId, clientSecret });
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(aadObjectId)}?$select=id,displayName,mail,userPrincipalName`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      const body = await response.text();
      console.warn(`[Teams] Graph no pudo resolver usuario ${aadObjectId}: ${response.status} ${truncateText(body, 300)}`);
      return null;
    }

    return response.json();
  } catch (error) {
    console.warn('[Teams] Error resolviendo usuario con Graph:', error.message);
    return null;
  }
}

async function getGraphAccessToken({ tenantId, clientId, clientSecret }) {
  if (graphTokenCache.accessToken && graphTokenCache.expiresAt > Date.now() + 60_000) {
    return graphTokenCache.accessToken;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Graph token error ${response.status}: ${truncateText(text, 300)}`);
  }

  const data = await response.json();
  graphTokenCache.accessToken = data.access_token;
  graphTokenCache.expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  return graphTokenCache.accessToken;
}

function getTeamsText(activity) {
  const clonedActivity = { ...activity };
  let withoutMention = '';
  try {
    withoutMention = TurnContext.removeRecipientMention(clonedActivity);
  } catch {
    withoutMention = clonedActivity.text || '';
  }
  return stripHtml(withoutMention || clonedActivity.text || activity?.text || '')
    .replace(/^@\S+\s+/, '')
    .trim();
}

class TeamsSupportBot extends TeamsActivityHandler {
  constructor() {
    super();

    this.onMessage(async (context, next) => {
      await handleTeamsMessage(context);
      await next();
    });
  }
}

const teamsAdapter = new CloudAdapter(new ConfigurationBotFrameworkAuthentication({
  MicrosoftAppId: process.env.MICROSOFT_APP_ID,
  MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD,
  MicrosoftAppType: process.env.MICROSOFT_APP_TYPE || 'MultiTenant',
  MicrosoftAppTenantId: process.env.AZURE_TENANT_ID || process.env.MICROSOFT_APP_TENANT_ID
}));

teamsAdapter.onTurnError = async (context, error) => {
  console.error('[Teams] Error procesando actividad:', error);
  await sendTeamsReply(context, 'Tuve un problema técnico procesando el mensaje en Teams. Intenta de nuevo en unos minutos.');
};

const teamsBot = new TeamsSupportBot();

async function sendTeamsReply(context, text) {
  const content = text || 'No pude generar una respuesta para ese mensaje.';
  console.log(`[Teams] Enviando respuesta a conversation=${context.activity?.conversation?.id || 'unknown'} length=${content.length}`);

  try {
    const result = await Promise.race([
      context.sendActivity({ type: 'message', text: content }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout enviando respuesta a Teams')), 15000))
    ]);
    console.log('[Teams] Respuesta enviada:', JSON.stringify(result));
    await auditTeamsEvent(context.activity, 'reply_sent', {
      replyLength: content.length,
      resourceId: result?.id
    });
    return result;
  } catch (error) {
    console.error('[Teams] Error enviando respuesta:', error);
    await auditTeamsEvent(context.activity, 'reply_error', {
      error: truncateText(error.message, 300)
    });
    throw error;
  }
}

async function handleTeamsMessage(context) {
  const allowedConversationIds = getTeamsAllowedConversationIds();
  const conversationId = context.activity?.conversation?.id;

  if (allowedConversationIds.length > 0 && !allowedConversationIds.includes(conversationId)) {
    await auditTeamsEvent(context.activity, 'conversation_denied');
    await sendTeamsReply(context, 'Este bot de soporte IT no está habilitado para este chat o canal de Teams.');
    return;
  }

  const text = getTeamsText(context.activity);
  if (!text) {
    await sendTeamsReply(context, 'Escríbeme tu consulta de soporte IT para ayudarte.');
    return;
  }

  const user = await resolveTeamsUser(context.activity);
  if (!user) {
    const aadObjectId = context.activity?.from?.aadObjectId || 'no disponible';
    await auditTeamsEvent(context.activity, 'user_not_mapped');
    await sendTeamsReply(context,
      `Tu usuario de Teams aún no está vinculado a ServiceDesk Plus.\n\nAAD Object ID: ${aadObjectId}\nNombre: ${context.activity?.from?.name || 'no disponible'}\n\nAgrega este usuario en TEAMS_USER_OVERRIDES para habilitar tickets y consultas seguras.`
    );
    return;
  }

  await auditTeamsEvent(context.activity, 'message_received', {
    user: {
      name: user.name,
      emailDomain: getEmailDomain(user.email),
      sdpRequesterId: user.sdpRequesterId || user.id
    }
  });

  const session = getTeamsSession(context.activity, user);
  const normalizedText = text.toLowerCase();

  if (CONFIRMATION_WORDS.has(normalizedText)) {
    const pending = [...session.pendingActions.keys()][0];
    const action = pending ? takePendingAction(session, pending) : null;

    if (!action) {
      await sendTeamsReply(context, 'No tengo una acción pendiente para confirmar, o ya expiró.');
      return;
    }

    try {
      const summary = await executeConfirmedAction(action, user);
      session.history = pushChatHistory(session.history, 'assistant', summary);
      await sendTeamsReply(context, summary);
    } catch (error) {
      await auditToolCall({ user, toolName: action.toolName, args: action.args, outcome: 'confirmed_error' });
      console.error(`[Teams] Error confirmando acción ${action.toolName}:`, error.message);
      await sendTeamsReply(context, `No pude ejecutar la acción confirmada: ${error.message}`);
    }
    return;
  }

  if (CANCEL_WORDS.has(normalizedText)) {
    session.pendingActions.clear();
    await sendTeamsReply(context, 'Listo, cancelé la acción pendiente.');
    return;
  }

  const chunks = [];
  await runSupportTurn({
    message: text,
    user,
    history: session.history,
    createPendingActionForUser: (action) => createPendingAction(session, action),
    onStatus: () => {},
    onText: (content) => chunks.push(content),
    onConfirmationRequired: () => chunks.push('\n\nResponde **CONFIRMAR** para ejecutar esta acción o **CANCELAR** para descartarla.'),
    streamSummary: false
  });

  const response = truncateText(chunks.join('').trim(), 27000);
  session.history = pushChatHistory(pushChatHistory(session.history, 'user', text), 'assistant', response);
  await sendTeamsReply(context, response || 'No pude generar una respuesta para ese mensaje.');
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await callMcpTool("sdp_authenticate_user", { username, password });

    const data = JSON.parse(result.content[0].text);
    const user = await enrichUserWithSdp(data.user);
    if (!getRequesterId(user)) {
      console.warn(`[Auth] Usuario autenticado sin requester SDP: ${user?.email || user?.name || 'desconocido'}`);
    }
    const token = createSession(user);
    res.json({ ...data, user, token });
  } catch (error) {
    console.error("Error en login:", error);
    const authError = /credenciales|usuario no encontrado|autenticaci/i.test(error.message);
    res.status(authError ? 401 : 500).json({ success: false, message: authError ? 'Credenciales inválidas.' : 'Error del servidor de autenticación.' });
  }
});

app.post('/api/logout', requireAuth, async (req, res) => {
  sessions.delete(req.sessionToken);
  res.json({ success: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  res.json({ success: true, user: req.user });
});

app.post('/api/verify-user', requireAuth, async (req, res) => {
  const { search_text } = req.body;

  try {
    const result = await mcpClient.request(
      {
        method: "tools/call",
        params: {
          name: "sdp_search_user",
          arguments: { search_text }
        },
      },
      CallToolResultSchema
    );

    if (result.isError) {
      return res.json({ success: false, message: "Error del sistema de soporte: " + result.content[0].text });
    }

    let data;
    try {
      data = JSON.parse(result.content[0].text);
    } catch (e) {
      return res.json({ success: false, message: "Error al procesar respuesta del sistema." });
    }

    const users = data.users || [];
    
    if (users.length > 0) {
      res.json({ success: true, user: users[0] });
    } else {
      res.json({ success: false, message: "Usuario no encontrado o no autorizado." });
    }
  } catch (error) {
    console.error("Error verificando usuario:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/get-ticket-status', requireAuth, async (req, res) => {
  const { request_id } = req.body;

  try {
    const result = await mcpClient.request(
      {
        method: "tools/call",
        params: {
          name: "sdp_get_request_details",
          arguments: { request_id }
        },
      },
      CallToolResultSchema
    );

    const data = JSON.parse(result.content[0].text);
    if (!userCanAccessRequest(req.user, data)) {
      return res.status(403).json({ success: false, message: 'No tienes permiso para consultar ese ticket.' });
    }
    res.json(data);
  } catch (error) {
    console.error("Error consultando ticket via MCP:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/list-requests', requireAuth, async (req, res) => {
  const { filter_by, limit } = req.body;
  const scopedRequesterId = getRequesterId(req.user);

  if (!scopedRequesterId) {
    return res.status(403).json({ success: false, message: 'Tu usuario no está vinculado a un solicitante de ServiceDesk Plus.' });
  }

  try {
    const result = await mcpClient.request(
      {
        method: "tools/call",
        params: {
          name: "sdp_list_requests",
          arguments: { 
            filter_by: filter_by || "All_Requests", 
            limit: limit || 20,
            requester_id: scopedRequesterId
          }
        },
      },
      CallToolResultSchema
    );

    const data = JSON.parse(result.content[0].text);
    res.json(data);
  } catch (error) {
    console.error("Error listando tickets via MCP:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sdp-catalogs', requireAuth, async (req, res) => {
  const catalogType = req.query.type || 'all';

  try {
    const result = await callMcpTool('sdp_get_catalogs', { catalog_type: catalogType });
    const data = JSON.parse(result.content[0].text);
    res.json({ success: true, catalog_type: catalogType, data });
  } catch (error) {
    console.error("Error consultando catálogos SDP:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/create-ticket', requireAuth, async (req, res) => {
  const { subject, description, category, subcategory, priority, confirmed } = req.body;

  if (confirmed !== true) {
    await auditToolCall({
      user: req.user,
      toolName: 'sdp_create_request',
      args: { subject, category, subcategory, priority },
      outcome: 'confirmation_required'
    });
    return res.status(409).json({ success: false, message: 'Crear un ticket requiere confirmación explícita.' });
  }

  try {
    const result = await mcpClient.request(
      {
        method: "tools/call",
        params: {
          name: "sdp_create_request",
          arguments: {
            subject,
            description,
            category,
            subcategory,
            priority,
            request_type: "Solicitud",
            requester: req.user?.name
          }
        },
      },
      CallToolResultSchema
    );

    const data = JSON.parse(result.content[0].text);
    await auditToolCall({
      user: req.user,
      toolName: 'sdp_create_request',
      args: { subject, category, subcategory, priority },
      outcome: 'success'
    });
    res.json(data);
  } catch (error) {
    console.error("Error creando ticket via MCP:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/confirm-action', requireAuth, async (req, res) => {
  const { actionId } = req.body;
  const action = takePendingAction(req.session, actionId);

  if (!action) {
    return res.status(404).json({ success: false, message: 'La acción pendiente expiró o ya fue usada.' });
  }

  try {
    const summary = await executeConfirmedAction(action, req.user);
    res.json({ success: true, message: summary });
  } catch (error) {
    await auditToolCall({ user: req.user, toolName: action.toolName, args: action.args, outcome: 'confirmed_error' });
    console.error(`[Bridge] Error confirmando acción ${action.toolName}:`, error.message);
    res.status(500).json({ success: false, message: `No pude ejecutar la acción confirmada: ${error.message}` });
  }
});

// NUEVO: Endpoint de Chat Agéntico
app.post('/api/chat', async (req, res) => {
  const { message, history } = req.body;
  const auth = getSessionForRequest(req);

  if (!auth) {
    return res.status(401).json({ success: false, message: 'Sesión expirada o inválida.' });
  }

  const userContext = auth.session.user;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    await runSupportTurn({
      message,
      user: userContext,
      history,
      createPendingActionForUser: (action) => createPendingAction(auth.session, action),
      onStatus: (statusMessage) => sendEvent('status', { message: statusMessage }),
      onText: (content) => sendEvent('text', { content }),
      onConfirmationRequired: (data) => sendEvent('confirmation_required', data),
      streamSummary: true
    });
    sendEvent('done', {});
    res.end();

  } catch (error) {
    sendEvent('error', { message: error.message });
    res.end();
  }
});

app.post('/api/teams/messages', async (req, res) => {
  await teamsAdapter.process(req, res, async (context) => {
    await teamsBot.run(context);
  });
});

app.post('/api/teams/dev-message', async (req, res) => {
  const expectedToken = process.env.TEAMS_DEV_TEST_TOKEN;
  const providedToken = req.get('x-teams-dev-token');

  if (!expectedToken || providedToken !== expectedToken) {
    return res.status(404).json({ success: false, message: 'Endpoint no disponible.' });
  }

  const {
    text,
    aadObjectId = 'dev-aad-object-id',
    name = 'Usuario Teams Dev',
    conversationId = 'dev-conversation',
    conversationType = 'personal',
    tenantId = process.env.AZURE_TENANT_ID || 'dev-tenant'
  } = req.body || {};

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ success: false, message: 'El campo text es requerido.' });
  }

  const replies = [];
  const fakeContext = {
    activity: {
      text,
      type: 'message',
      channelId: 'msteams',
      conversation: {
        id: conversationId,
        conversationType,
        tenantId
      },
      from: {
        id: aadObjectId,
        aadObjectId,
        name
      },
      recipient: {
        id: 'dev-bot',
        name: 'Soporte IT'
      }
    },
    sendActivity: async (message) => {
      replies.push(typeof message === 'string' ? message : message?.text || JSON.stringify(message));
    }
  };

  try {
    await handleTeamsMessage(fakeContext);
    res.json({ success: true, replies });
  } catch (error) {
    console.error('[Teams Dev] Error simulando mensaje:', error);
    res.status(500).json({ success: false, message: error.message, replies });
  }
});

app.get('/api/teams/health', (req, res) => {
  const overrides = parseJsonEnv('TEAMS_USER_OVERRIDES', {});
  res.json({
    success: true,
    endpoint: '/api/teams/messages',
    configured: {
      microsoftAppId: Boolean(process.env.MICROSOFT_APP_ID),
      microsoftAppPassword: Boolean(process.env.MICROSOFT_APP_PASSWORD),
      microsoftAppType: process.env.MICROSOFT_APP_TYPE || 'MultiTenant',
      graphUserLookup: isGraphUserLookupEnabled(),
      azureTenantId: Boolean(process.env.AZURE_TENANT_ID || process.env.MICROSOFT_TENANT_ID),
      devTestEndpoint: Boolean(process.env.TEAMS_DEV_TEST_TOKEN),
      allowedConversations: getTeamsAllowedConversationIds().length,
      userOverrides: Object.keys(overrides).length
    }
  });
});

app.listen(PORT, () => {
  console.log(`Chatbot Backend Bridge corriendo en http://localhost:${PORT}`);
  initMCP();
});
