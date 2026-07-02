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
import { formatKnowledgeContext, searchKnowledge } from './rag.js';
import { getTicketRoutingMap, normalizeRoutingText, resolveTicketRoutingFromText } from './ticket-routing.js';
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
  'sdp_update_mci',
  'sdp_execute_automation_action'
]);
const REQUEST_SCOPED_MUTATION_TOOLS = new Set([
  'sdp_add_note',
  'sdp_resolve_request',
  'sdp_assign_request',
  'sdp_update_request',
  'sdp_update_mci',
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
  const normalizedUser = withUserRole(user);
  const token = randomUUID();
  sessions.set(token, {
    user: normalizedUser,
    expiresAt: Date.now() + SESSION_TTL_MS,
    pendingActions: new Map()
  });
  return token;
}

function withUserRole(user) {
  if (!user) return user;
  const candidate = { ...user };
  candidate.role = isSupportAdmin(candidate) ? 'support_admin' : (candidate.role || 'user');
  return candidate;
}

function getRequesterId(user) {
  return user?.sdpRequesterId || user?.id;
}

function isSupportAdmin(user) {
  if (!user) return false;
  if (user.isSupportAdmin || user.role === 'admin' || user.role === 'support_admin') return true;

  const adminAadObjectIds = getCsvEnvSet('TEAMS_ADMIN_AAD_OBJECT_IDS');
  const adminEmails = getCsvEnvSet('SUPPORT_ADMIN_EMAILS');
  const adminRequesterIds = getCsvEnvSet('SUPPORT_ADMIN_SDP_REQUESTER_IDS');
  const aadObjectId = String(user.aadObjectId || '').toLowerCase();
  const email = String(user.email || '').toLowerCase();
  const requesterId = String(getRequesterId(user) || '').toLowerCase();

  return Boolean(
    (aadObjectId && adminAadObjectIds.has(aadObjectId)) ||
    (email && adminEmails.has(email)) ||
    (requesterId && adminRequesterIds.has(requesterId))
  );
}

function isMciAdmin(user) {
  if (!user) return false;

  const adminAadObjectIds = getCsvEnvSet('MCI_ADMIN_AAD_OBJECT_IDS');
  const adminEmails = getCsvEnvSet('MCI_ADMIN_EMAILS');
  const adminRequesterIds = getCsvEnvSet('MCI_ADMIN_SDP_REQUESTER_IDS');
  const aadObjectId = String(user.aadObjectId || '').toLowerCase();
  const email = String(user.email || '').toLowerCase();
  const requesterId = String(getRequesterId(user) || '').toLowerCase();

  return Boolean(
    (aadObjectId && adminAadObjectIds.has(aadObjectId)) ||
    (email && adminEmails.has(email)) ||
    (requesterId && adminRequesterIds.has(requesterId)) ||
    (adminAadObjectIds.size === 0 && adminEmails.size === 0 && adminRequesterIds.size === 0 && isSupportAdmin(user))
  );
}

function getCsvEnvSet(name) {
  return new Set(
    (process.env[name] || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
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

function userCanReadRequest(user, data) {
  return isSupportAdmin(user) || userCanAccessRequest(user, data);
}

function isMciRequestData(data) {
  const request = data?.request || data;
  const udfFields = request?.udf_fields || {};
  const templateName = request?.template?.name || request?.request_template?.name || request?.template_name;
  const templateId = String(request?.template?.id || request?.request_template?.id || '');

  return templateName === 'PlantMCI' ||
    templateId === '604' ||
    Boolean(udfFields.udf_pick_1503 || udfFields.udf_pick_1501 || udfFields.udf_pick_1504);
}

function getMciLeaderValue(data) {
  const request = data?.request || data;
  const leader = request?.udf_fields?.udf_pick_1503;
  if (!leader) return '';
  if (typeof leader === 'string') return leader;
  return leader.name || leader.display_value || leader.value || '';
}

function userMatchesMciLeader(user, data) {
  const leader = normalizeComparableText(getMciLeaderValue(data));
  if (!leader) return false;

  return [
    user?.name,
    user?.email,
    user?.login_name,
    user?.userPrincipalName
  ].some((value) => {
    const normalized = normalizeComparableText(value);
    return normalized && (normalized === leader || leader.includes(normalized) || normalized.includes(leader));
  });
}

function mciUpdateChangesLeader(args) {
  return Boolean(args?.fields?.leader || args?.fields?.leader_name || args?.fields?.mci_leader);
}

function getDisallowedLeaderMciUpdateFields(args) {
  const leaderEditableFields = new Set(['current_date', 'description', 'predictive', 'progress']);
  return Object.keys(args?.fields || {}).filter((field) => !leaderEditableFields.has(field));
}

async function auditToolCall({ user, toolName, args, outcome, error }) {
  const record = {
    timestamp: new Date().toISOString(),
    user: {
      name: user?.name,
      email: user?.email,
      sdpRequesterId: user?.sdpRequesterId || user?.id,
      role: isSupportAdmin(user) ? 'support_admin' : 'user'
    },
    toolName,
    args: minimizeAuditArgs(args),
    outcome
  };
  const minimizedError = minimizeAuditError(error);
  if (minimizedError) {
    record.error = minimizedError;
  }

  try {
    await appendFile(path.join(__dirname, 'audit.log'), `${JSON.stringify(record)}\n`);
  } catch (error) {
    console.warn('[Audit] No se pudo escribir audit.log:', error.message);
  }
}

function minimizeAuditError(error) {
  if (!error) return null;
  const message = redactSensitiveText(error.message || String(error));
  const parsed = extractJsonFromErrorMessage(message);
  const responseStatus = parsed?.response_status || parsed?.operation?.response_status;
  const messages = Array.isArray(responseStatus?.messages) ? responseStatus.messages : [];
  const fields = [...new Set(messages.flatMap((entry) => {
    if (Array.isArray(entry.fields)) return entry.fields;
    if (entry.field) return [entry.field];
    return [];
  }).filter(Boolean))];
  const details = messages.map((entry) => ({
    status_code: entry.status_code,
    field: entry.field,
    fields: entry.fields,
    type: entry.type,
    message: redactSensitiveText(entry.message || '')
  }));

  return {
    message: truncateText(messages[0]?.message || message, 500),
    status: responseStatus?.status,
    status_code: responseStatus?.status_code || error.status || error.response?.status,
    fields,
    details: details.length ? details : undefined
  };
}

function extractJsonFromErrorMessage(message) {
  const start = String(message || '').indexOf('{');
  const end = String(message || '').lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(message.slice(start, end + 1));
  } catch {
    return null;
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

  if (args.sophia_classification) {
    minimized.sophia_classification = args.sophia_classification;
  }

  return minimized;
}

function createAuditTextPreview(text, maxLength = 500) {
  return truncateText(redactSensitiveText(stripHtml(String(text || ''))), maxLength);
}

function createTeamsActivityPreview(activity) {
  return createAuditTextPreview(getTeamsText(activity), 500);
}

function createAdaptiveCardPreview(card) {
  const texts = [];
  const visit = (value) => {
    if (!value || texts.length >= 12) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === 'object') {
      if (value.type === 'TextBlock' && value.text) {
        texts.push(String(value.text));
      }
      Object.values(value).forEach(visit);
    }
  };
  visit(card?.body || card);
  return createAuditTextPreview(texts.join('\n'), 800);
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

function formatPendingActionSummary({ toolName, args, user, intro }) {
  if (toolName === 'sdp_create_request') {
    return formatCreateRequestConfirmation(args, user, intro);
  }

  return `${intro || 'Preparé la acción solicitada.'}\n\nPara proteger tus tickets y accesos, esta acción requiere confirmación explícita antes de ejecutarse.`;
}

function formatCreateRequestConfirmation(args = {}, user, intro) {
  const classification = args.sophia_classification || {};
  const lines = [
    intro || 'Preparé esta solicitud para ServiceDesk Plus.',
    '',
    '**Solicitud preparada**',
    '',
    `| Campo | Valor |`,
    `| --- | --- |`,
    `| Asunto | ${escapeMarkdownTableValue(args.subject || 'Sin asunto')} |`,
    `| Categoría | ${escapeMarkdownTableValue(args.category || '-')} |`,
    `| Subcategoría | ${escapeMarkdownTableValue(args.subcategory || '-')} |`,
    `| Prioridad | ${escapeMarkdownTableValue(args.priority || '-')} |`,
    `| Tipo | ${escapeMarkdownTableValue(args.request_type || '-')} |`,
    `| Solicitante | ${escapeMarkdownTableValue(user?.name || args.requester || '-')} |`
  ];

  if (classification.routing || classification.confidence) {
    lines.push(
      '',
      '**Clasificación Sophia**',
      '',
      `| Campo | Valor |`,
      `| --- | --- |`,
      `| Ruta | ${escapeMarkdownTableValue(classification.routing || '-')} |`,
      `| Confianza | ${escapeMarkdownTableValue(classification.confidence || '-')} |`,
      `| Señales | ${escapeMarkdownTableValue((classification.matchedKeywords || []).join(', ') || '-')} |`,
      `| Fuente | ${escapeMarkdownTableValue(classification.evidenceSource || '-')} |`
    );
  }

  if (args.description) {
    lines.push('', `**Descripción**`, truncateText(redactSensitiveText(stripHtml(args.description)), 500));
  }

  lines.push('', 'Revisa estos datos antes de confirmar.');
  return lines.join('\n');
}

function escapeMarkdownTableValue(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
    .trim();
}

function normalizeTicketToolDecision(aiDecision, message, user) {
  if (
    aiDecision?.tool_name === 'sdp_search_user' &&
    isSupportAdmin(user) &&
    !isCreateTicketIntent(message) &&
    /\btickets?\b|\bsolicitudes?\b|\bmci\b/i.test(String(message || ''))
  ) {
    const searchText = aiDecision.tool_args?.search_text || aiDecision.tool_args?.query || extractRequesterNameFromMessage(message);
    const assignedTechnicianName = aiDecision.tool_args?.assigned_technician_name || inferAssignedTechnicianNameFromMessage(message);
    const mciLeaderName = isMciListRequest(message)
      ? aiDecision.tool_args?.mci_leader_name || inferMciLeaderNameFromMessage(message) || searchText
      : null;
    aiDecision.tool_name = 'sdp_list_requests';
    aiDecision.tool_args = {
      requester_name: assignedTechnicianName || mciLeaderName ? undefined : searchText,
      assigned_technician_name: isMciListRequest(message) ? undefined : assignedTechnicianName || undefined,
      mci_leader_name: mciLeaderName || undefined,
      filter_by: inferRequestFilterFromMessage(message) || undefined,
      status: inferRequestStatusFromMessage(message) || undefined,
      mci_only: isMciListRequest(message) || undefined
    };
  }
}

async function prepareToolArgs(toolName, toolArgs, user, message = '') {
  const args = { ...(toolArgs || {}) };

  if (toolName === 'sdp_list_requests') {
    const requesterId = getRequesterId(user);
    if (!requesterId) {
      throw new Error('Usuario sin solicitante vinculado en ServiceDesk Plus.');
    }
    if (isSupportAdmin(user) && !isPersonalTicketsRequest(message)) {
      if (isMciListRequest(message)) {
        if (!hasRequesterScope(message)) {
          args.mci_leader_name = args.mci_leader_name ||
            args.mci_leader ||
            args.leader_name ||
            args.leader ||
            args.assigned_technician_name ||
            args.assigned_technician ||
            args.requester_name ||
            args.search_text ||
            inferMciLeaderNameFromMessage(message);
        }
      } else {
        args.assigned_technician_name = args.assigned_technician_name || args.assigned_technician || inferAssignedTechnicianNameFromMessage(message);
      }
    }
    if (isSupportAdmin(user) && !isPersonalTicketsRequest(message) && !args.requester_id) {
      const requesterName = args.assigned_technician_name || args.mci_leader_name
        ? null
        : args.requester_name || args.search_text || extractRequesterNameFromMessage(message);
      if (requesterName) {
        args.requester_id = await resolveSdpRequesterIdByName(requesterName);
      }
    }

    if (!isSupportAdmin(user) || isPersonalTicketsRequest(message)) {
      if (isMciListRequest(message) && !hasRequesterScope(message)) {
        args.mci_leader_name = args.mci_leader_name ||
          args.mci_leader ||
          args.leader_name ||
          args.leader ||
          user?.name ||
          user?.email;
        delete args.requester_id;
      } else {
        args.requester_id = requesterId;
      }
    }
    delete args.requester_name;
    delete args.search_text;
    if (isMciListRequest(message) && !hasAssignedTechnicianScope(message)) {
      delete args.assigned_technician_name;
    }
    delete args.assigned_technician;
    delete args.mci_leader;
    delete args.leader_name;
    delete args.leader;
    if (isMciListRequest(message)) {
      args.mci_only = true;
    }
    args.status = args.status || inferRequestStatusFromMessage(message);
    if (args.status) {
      delete args.filter_by;
    } else {
      args.filter_by = args.filter_by || inferRequestFilterFromMessage(message) || 'All_Requests';
    }
  }

  if (toolName === 'sdp_create_request' && user?.name) {
    args.requester = user.name;
    args.requester_id = getRequesterId(user);
    const classification = await classifyTicketWithKnowledge({ ...args, message }, user);
    applyTicketClassificationToArgs(args, classification);
    sanitizeCreateRequestArgs(args);
  }

  if (toolName === 'sdp_update_mci') {
    args.fields = normalizeMciUpdateFields(args.fields || args);
  }

  if (toolName === 'sdp_execute_automation_action' && user?.email && !args.user_email) {
    args.user_email = user.email;
  }

  return args;
}

function normalizeMciUpdateFields(fields = {}) {
  const normalized = {};
  const fieldAliases = {
    leader: 'leader',
    lider: 'leader',
    linder: 'leader',
    lider_mci: 'leader',
    mci_leader: 'leader',
    prioridad_mci: 'mci_priority',
    mci_priority: 'mci_priority',
    priorizar: 'prioritize',
    prioritize: 'prioritize',
    mci: 'mci',
    num_mci: 'mci_number',
    numero_mci: 'mci_number',
    mci_number: 'mci_number',
    fecha_inicio: 'start_date',
    fecha_inicio_mci: 'start_date',
    start_date: 'start_date',
    fecha_tope: 'due_date',
    fecha_tope_ejecucion: 'due_date',
    due_date: 'due_date',
    semana_anterior: 'previous_week',
    previous_week: 'previous_week',
    fecha_actual: 'current_date',
    fecha_actualizacion: 'current_date',
    fecha_de_actualizacion: 'current_date',
    fecha_ultima_actualizacion: 'current_date',
    fecha_de_ultima_actualizacion: 'current_date',
    ultima_actualizacion: 'current_date',
    current_date: 'current_date',
    etapa: 'stage',
    stage: 'stage',
    etapa_anterior: 'previous_stage',
    previous_stage: 'previous_stage',
    avance: 'progress',
    porcentaje_avance: 'progress',
    progress: 'progress',
    predictiva: 'predictive',
    predictive: 'predictive',
    tecnico_asignado: 'assigned_technician',
    assigned_technician: 'assigned_technician',
    estado: 'status',
    status: 'status',
    asunto: 'subject',
    subject: 'subject',
    descripcion: 'description',
    description: 'description'
  };

  for (const [key, value] of Object.entries(fields || {})) {
    if (['request_id', 'comments'].includes(key)) continue;
    const normalizedKey = fieldAliases[normalizeFieldAlias(key)] || key;
    normalized[normalizedKey] = value;
  }

  return normalized;
}

function normalizeFieldAlias(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function inferRequestFilterFromMessage(message) {
  const text = String(message || '').toLowerCase();
  if (/\b(cerrad|resuelt|closed|resolved)\w*/i.test(text)) return 'Closed_Requests';
  if (/\b(abiert|pendient|open|progreso|progress)\w*/i.test(text)) return 'Open_Requests';
  return null;
}

function inferRequestStatusFromMessage(message) {
  const text = String(message || '').toLowerCase();
  const statusPatterns = [
    { pattern: /\ben espera\b/i, status: 'En Espera' },
    { pattern: /\ben proceso\b/i, status: 'En Proceso' },
    { pattern: /\bsuspendid[oa]s?\b/i, status: 'Suspendido' },
    { pattern: /\bcancelad[oa]s?\b|\bcancelled\b/i, status: 'Cancelled' }
  ];

  return statusPatterns.find(({ pattern }) => pattern.test(text))?.status || null;
}

function extractRequesterNameFromMessage(message) {
  const text = String(message || '').trim();
  const patterns = [
    /\btickets?\s+(?:del solicitante|del usuario|de|para)\s+(.+?)(?:\s+como\s+|\s+en estado|\s+cerrad|\s+abiert|\s+resuelt|\s+pendient|$)/i,
    /\bsolicitudes?\s+(?:del solicitante|del usuario|de|para)\s+(.+?)(?:\s+como\s+|\s+en estado|\s+cerrad|\s+abiert|\s+resuelt|\s+pendient|$)/i,
    /\bmci\s+(?:del solicitante|del usuario|de|para)\s+(.+?)(?:\s+como\s+|\s+en estado|\s+cerrad|\s+abiert|\s+resuelt|\s+pendient|$)/i,
    /\b(?:tickets?|solicitudes?|mci)\b.*?\b(?:del solicitante|del usuario|de|para)\s+(.+?)(?:\s+como\s+|\s+en estado|\s+cerrad|\s+abiert|\s+resuelt|\s+pendient|$)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/[?.!,;:]+$/, '');
  }

  return null;
}

function inferAssignedTechnicianNameFromMessage(message) {
  const text = String(message || '').trim();
  if (!hasAssignedTechnicianScope(message)) return null;

  const patterns = [
    /\b(?:t[eé]cnico asignado|tecnico asignado|asignad[oa]s?\s+a)\s+(.+?)(?:\s+en estado|\s+cerrad|\s+abiert|\s+resuelt|\s+pendient|$)/i,
    /\b(?:tickets?|solicitudes?|mci)\b.*?\b(?:de|para)\s+(.+?)\s+como\s+(?:t[eé]cnico asignado|tecnico asignado)\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/[?.!,;:]+$/, '');
  }

  return extractRequesterNameFromMessage(message);
}

function inferMciLeaderNameFromMessage(message) {
  const text = String(message || '').trim();
  if (!isMciListRequest(text)) return null;
  if (hasRequesterScope(text)) return null;
  if (hasAssignedTechnicianScope(text)) return null;

  const patterns = [
    /\bmci\b.*?\b(?:l[ií]der(?:\s+de\s+mci)?|lider(?:\s+de\s+mci)?|linder(?:\s+de\s+mci)?|a cargo de)\s+(.+?)(?:\s+y\s+sus\b|\s+con\b|\s+en estado|\s+cerrad|\s+abiert|\s+resuelt|\s+pendient|$)/i,
    /\bmci\s+(?:del|de la|de los|de las|de|para)\s+(.+?)(?:\s+y\s+sus\b|\s+con\b|\s+en estado|\s+cerrad|\s+abiert|\s+resuelt|\s+pendient|$)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanExtractedPersonName(match[1]);
  }

  return null;
}

function cleanExtractedPersonName(value) {
  return String(value || '')
    .trim()
    .replace(/\b(?:y\s+sus\s+)?(?:porcentajes?\s+de\s+)?avance\b.*$/i, '')
    .replace(/\bpredictiva\b.*$/i, '')
    .replace(/\bcomentarios?\b.*$/i, '')
    .replace(/\bfecha\s+de\s+(?:ultima|última)\s+actualizaci[oó]n\b.*$/i, '')
    .replace(/[?.!,;:]+$/, '')
    .trim();
}

function hasRequesterScope(message) {
  return /\b(solicitante|del solicitante|como solicitante|reportad[oa]\s+por|cread[oa]\s+por)\b/i.test(String(message || ''));
}

function hasAssignedTechnicianScope(message) {
  return /\b(t[eé]cnico asignado|tecnico asignado|asignad[oa]s?\s+a|como t[eé]cnico asignado|como tecnico asignado)\b/i.test(String(message || ''));
}

function getAdminPersonScopeClarification(message, user) {
  if (!isSupportAdmin(user) || isPersonalTicketsRequest(message)) return null;
  if (isCreateTicketIntent(message)) return null;
  if (!/\b(tickets?|solicitudes?|mci)\b/i.test(String(message || ''))) return null;
  if (isMciListRequest(message)) return null;
  if (hasRequesterScope(message) || hasAssignedTechnicianScope(message)) return null;

  const personName = extractRequesterNameFromMessage(message);
  if (!personName) return null;

  return `Para consultar a ${personName}, necesito aclarar el criterio de búsqueda: ¿quieres verlo como solicitante o en el campo Técnico asignado?`;
}

async function resolveSdpRequesterIdByName(searchText) {
  const result = await callMcpTool('sdp_search_user', { search_text: searchText });
  const data = JSON.parse(result.content[0].text);
  const users = extractSdpUsers(data);
  const normalizedSearch = normalizeComparableText(searchText);
  const match = users.find((candidate) => normalizeComparableText(candidate.name) === normalizedSearch)
    || users.find((candidate) => normalizeComparableText(candidate.email_id || candidate.email || candidate.mail) === normalizedSearch)
    || users[0];

  if (!match?.id) {
    throw new Error(`No encontré un solicitante en ServiceDesk Plus para "${searchText}".`);
  }

  return String(match.id);
}

function normalizeComparableText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPersonalTicketsRequest(message) {
  const text = String(message || '').toLowerCase();
  return /\b(mis|m[ií]os|m[ií]as|propios|propias|mi ticket|mi solicitud|mi mci|mis mci)\b/i.test(text);
}

function isMciListRequest(message) {
  return /\bmci\b/i.test(String(message || ''));
}

function isCreateTicketIntent(message) {
  const text = String(message || '').toLowerCase();
  return (
    /\b(crea|crear|cr[eé]ame|levanta|levantar|abre|abrir|reporta|reportar|registra|registrar)\b.*\b(ticket|solicitud)\b/i.test(text) ||
    /\b(ticket|solicitud)\b.*\b(por|porque|ya que|debido a|para reportar)\b/i.test(text)
  );
}

async function classifyTicketWithKnowledge(input, user) {
  const subject = String(input.subject || '').trim();
  const description = String(input.description || input.message || input.text || '').trim();
  const query = [subject, description].filter(Boolean).join('\n\n');
  const draftArgs = {
    subject: subject || truncateText(description, 90) || 'Solicitud de soporte',
    description,
    priority: normalizePriority(input.priority) || inferPriorityFromText(query)
  };
  const routing = resolveTicketRouting(draftArgs);
  const suggestionArgs = { ...draftArgs };
  applyCreateTicketDefaults(suggestionArgs);

  let evidence = [];
  try {
    evidence = await searchKnowledge(query, {
      role: isSupportAdmin(user) ? 'support_admin' : user?.role || 'user',
      limit: Number(process.env.RAG_CLASSIFY_TOP_K || 5),
      minScore: Number(process.env.RAG_CLASSIFY_MIN_SCORE || 0.3)
    });
  } catch (error) {
    console.warn('[RAG] No se pudo recuperar evidencia para clasificación:', error.message);
  }

  const topEvidence = evidence[0];
  const confidence = getTicketClassificationConfidence(routing, topEvidence);

  return {
    suggestion: {
      subject: suggestionArgs.subject,
      category: suggestionArgs.category,
      subcategory: suggestionArgs.subcategory,
      priority: suggestionArgs.priority,
      request_type: suggestionArgs.request_type,
      udf_fields: suggestionArgs.udf_fields
    },
    routing: routing.name ? {
      name: routing.name,
      matchedKeywords: routing.matchedKeywords || []
    } : {
      name: 'default',
      matchedKeywords: []
    },
    confidence,
    reason: createTicketClassificationReason(routing, topEvidence),
    evidence: evidence.map((result) => ({
      id: result.id,
      title: result.title,
      source: result.source,
      area: result.area,
      visibility: result.visibility,
      score: Number(result.score.toFixed(4)),
      excerpt: truncateText(result.content, 700)
    }))
  };
}

function getTicketClassificationConfidence(routing, topEvidence) {
  if (routing?.name && topEvidence?.score >= 0.68) return 'alta';
  if (routing?.name) return 'media';
  if (topEvidence?.score >= 0.68) return 'media_sin_regla_directa';
  return 'baja_default';
}

function createTicketClassificationReason(routing, topEvidence) {
  const parts = [];
  if (routing?.name) {
    parts.push(`Coincidió con la ruta "${routing.name}"`);
    if (routing.matchedKeywords?.length) {
      parts.push(`por las señales: ${routing.matchedKeywords.join(', ')}`);
    }
  } else {
    parts.push('No encontró una ruta por palabras clave; aplicó los valores por defecto');
  }

  if (topEvidence) {
    parts.push(`la evidencia RAG principal fue "${topEvidence.title}" (${topEvidence.source}) con score ${topEvidence.score.toFixed(3)}`);
  }

  return `${parts.join('; ')}.`;
}

function applyTicketClassificationToArgs(args, classification) {
  const suggestion = classification?.suggestion || {};
  args.subject = args.subject || suggestion.subject;
  args.category = suggestion.category;
  args.subcategory = suggestion.subcategory;
  args.priority = suggestion.priority;
  args.request_type = suggestion.request_type;
  args.udf_fields = {
    ...(args.udf_fields || {}),
    ...(suggestion.udf_fields || {})
  };
  args.sophia_classification = summarizeTicketClassificationForAudit(classification);
}

function sanitizeCreateRequestArgs(args) {
  delete args.impact;
  delete args.urgency;
}

function summarizeTicketClassificationForAudit(classification) {
  const evidence = classification?.evidence?.[0];
  return {
    routing: classification?.routing?.name || 'default',
    confidence: classification?.confidence || 'unknown',
    matchedKeywords: classification?.routing?.matchedKeywords || [],
    category: classification?.suggestion?.category,
    subcategory: classification?.suggestion?.subcategory,
    priority: classification?.suggestion?.priority,
    evidenceSource: evidence?.source,
    evidenceTitle: evidence?.title,
    evidenceScore: evidence?.score
  };
}

function applyCreateTicketDefaults(args) {
  const routing = resolveTicketRouting(args);
  const hasRouting = Boolean(routing.name);
  args.request_type = process.env.SDP_DEFAULT_REQUEST_TYPE || 'Solicitud';
  args.priority = normalizePriority(args.priority) || (hasRouting
    ? routing.priority
    : process.env.SDP_DEFAULT_PRIORITY || 'Media');
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

function inferPriorityFromText(text) {
  const normalized = normalizeRoutingText(text);
  if (/\b(prioridad alta|alta prioridad|urgente|critico|critica|crítico|crítica)\b/.test(normalized)) return 'Alta';
  if (/\b(prioridad baja|baja prioridad)\b/.test(normalized)) return 'Baja';
  if (/\b(prioridad media|media prioridad|prioridad normal|normal)\b/.test(normalized)) return 'Media';
  return undefined;
}

function resolveTicketRouting(args) {
  return resolveTicketRoutingFromText(args);
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

async function getRagContextForMessage(message, user) {
  if (String(process.env.RAG_ENABLED || 'true').toLowerCase() === 'false') return '';

  try {
    const results = await searchKnowledge(message, {
      role: isSupportAdmin(user) ? 'support_admin' : user?.role || 'user'
    });
    const context = formatKnowledgeContext(results);
    if (context) {
      console.log(`[RAG] ${results.length} fragmentos recuperados para la consulta.`);
    }
    return context;
  } catch (error) {
    console.warn('[RAG] Búsqueda de conocimiento omitida:', error.message);
    return '';
  }
}

async function runSupportTurn({
  message,
  user,
  history,
  createPendingActionForUser,
  onStatus,
  onText,
  onCard,
  onWorking,
  onConfirmationRequired,
  streamSummary = false,
  responseChannel = 'web'
}) {
  onStatus?.('Sophia está analizando tu solicitud...');

  const clarification = getAdminPersonScopeClarification(message, user);
  if (clarification) {
    onText(clarification);
    return;
  }

  const ragContext = await getRagContextForMessage(message, user);
  const aiDecision = await AgentOrchestrator.processMessage(message, { user, ragContext }, normalizeChatHistory(history));
  normalizeTicketToolDecision(aiDecision, message, user);
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
    preparedArgs = await prepareToolArgs(aiDecision.tool_name, aiDecision.tool_args || {}, user, message);
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
    onText(formatPendingActionSummary({
      toolName: aiDecision.tool_name,
      args: preparedArgs,
      user,
      intro: aiDecision.content
    }));
    onConfirmationRequired?.({
      actionId,
      toolName: aiDecision.tool_name,
      expiresInMs: PENDING_ACTION_TTL_MS
    });
    return;
  }

  console.log(`[Bridge] Ejecutando: ${aiDecision.tool_name} con args:`, JSON.stringify(aiDecision.tool_args));
  onStatus?.(`Consultando herramienta: ${aiDecision.tool_name}...`);
  await Promise.resolve(onWorking?.(createWorkingMessage(aiDecision, message)));

  try {
    const toolResult = await callMcpTool(aiDecision.tool_name, preparedArgs);
    await auditToolCall({ user, toolName: aiDecision.tool_name, args: preparedArgs, outcome: 'success' });

    const toolOutput = toolResult.content[0].text;
    if (aiDecision.tool_name === 'sdp_get_request_details') {
      const requestData = JSON.parse(toolOutput);
      if (!userCanReadRequest(user, requestData)) {
        onText('Encontré ese ticket, pero no pertenece a tu usuario autenticado. Por seguridad no puedo mostrarlo.');
        return;
      }
    }

    console.log(`[Bridge] Resultado técnico obtenido.`);

    if (responseChannel === 'teams' && aiDecision.tool_name === 'sdp_list_requests') {
      const card = createTicketsAdaptiveCard(toolOutput);
      if (card) {
        onCard?.(card);
        return;
      }
    }

    if (responseChannel === 'teams' && aiDecision.tool_name === 'sdp_get_request_details') {
      const card = createTicketDetailsAdaptiveCard(toolOutput);
      if (card) {
        onCard?.(card);
        return;
      }
    }

    if (streamSummary) {
      await streamToolSummary(toolOutput, (type, data) => {
        if (type === 'text_chunk') onText(data.content);
      }, { channel: responseChannel, toolName: aiDecision.tool_name });
    } else {
      onText(await summarizeToolOutput(toolOutput, { channel: responseChannel, toolName: aiDecision.tool_name }));
    }
  } catch (error) {
    console.error(`[Bridge] Error crítico ejecutando herramienta ${aiDecision.tool_name}:`, error.message);
    onText(`No pude completar esa consulta porque falló la conexión con **${aiDecision.tool_name}**. Puedes intentarlo de nuevo o pedirme una búsqueda más acotada mientras validamos ServiceDesk Plus.`);
  }
}

function createWorkingMessage(aiDecision, message = '') {
  const content = String(aiDecision?.content || '').trim();
  if (content && content.length <= 220 && !/dame un instante|espera|aguarda|procedo a/i.test(content)) {
    return content;
  }

  if (aiDecision?.tool_name === 'sdp_list_requests') {
    if (isMciListRequest(message)) {
      return pickWorkingMessage(message, [
        'Sí, reviso esas MCI y te separo lo relevante.',
        'Claro, busco las MCI con ese criterio y te lo organizo.',
        'Voy con esa búsqueda de MCI; te devuelvo un resumen legible.'
      ]);
    }
    return pickWorkingMessage(message, [
      'Claro, reviso esos tickets y te separo lo relevante.',
      'Voy a buscar esos tickets con el criterio que indicaste.',
      'Sí, hago la búsqueda y te lo devuelvo ordenado.'
    ]);
  }

  if (aiDecision?.tool_name === 'sdp_get_request_details') {
    return pickWorkingMessage(message, [
      'Claro, reviso el detalle de esa solicitud.',
      'Voy a abrir ese ticket y revisar lo importante.',
      'Sí, consulto el detalle y te resumo el estado.'
    ]);
  }

  if (aiDecision?.tool_name === 'sdp_search_user') {
    return pickWorkingMessage(message, [
      'Claro, valido ese usuario en ServiceDesk Plus.',
      'Busco ese usuario y te confirmo qué aparece.',
      'Sí, reviso los datos del usuario en SDP.'
    ]);
  }

  return pickWorkingMessage(message, [
    'Claro, reviso eso.',
    'Voy con esa solicitud.',
    'Sí, lo reviso y te cuento qué encuentro.'
  ]);
}

function pickWorkingMessage(seed, options) {
  const text = String(seed || '');
  const score = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return options[score % options.length];
}

async function executeConfirmedAction(action, user) {
  await assertToolAllowedForUser(action.toolName, action.args, user);
  const toolResult = await callMcpTool(action.toolName, action.args);
  const createdRequestId = action.toolName === 'sdp_create_request'
    ? extractRequestIdFromToolResult(toolResult)
    : null;
  await auditToolCall({
    user,
    toolName: action.toolName,
    args: createdRequestId ? { ...action.args, request_id: createdRequestId } : action.args,
    outcome: 'confirmed_success'
  });
  return summarizeToolOutput(toolResult.content[0].text);
}

function extractRequestIdFromToolResult(toolResult) {
  try {
    const data = JSON.parse(toolResult?.content?.[0]?.text || '{}');
    return data?.request?.id ||
      data?.request?.request_id ||
      data?.id ||
      data?.response?.request?.id ||
      data?.operation?.details?.request_id ||
      null;
  } catch {
    return null;
  }
}

async function streamToolSummary(toolOutput, sendEvent, options = {}) {
  const minimizedOutput = minimizeToolOutputForGemini(toolOutput);
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const systemInstruction = getSummarySystemInstruction({ channel: options.channel || 'web', toolName: options.toolName });
  try {
    const model = genAI.getGenerativeModel({
      model: GEMINI_SUMMARY_MODEL,
      systemInstruction
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
      systemInstruction
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

async function summarizeToolOutput(toolOutput, options = {}) {
  const minimizedOutput = minimizeToolOutputForGemini(toolOutput);
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const systemInstruction = getSummarySystemInstruction(options);
  const model = genAI.getGenerativeModel({
    model: GEMINI_SUMMARY_MODEL,
    systemInstruction
  });
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: `Resultado técnico minimizado: ${minimizedOutput}` }] }]
  });
  return result.response.text();
}

function getSummarySystemInstruction(options = {}) {
  const channel = options.channel || 'web';
  const toolName = options.toolName || '';
  const base = [
    'Eres Sophia, la asistente conversacional de Soporte IT de Barraza y Cía.',
    'Responde en español con una voz humana, clara y atenta. Debe sentirse como una persona competente explicando lo que encontró, no como una plantilla.',
    'Usa Markdown sobrio: tablas compactas cuando hay varios registros, y texto breve cuando el resultado se entiende mejor en prosa.',
    'No uses emojis, listas con alineación manual, columnas innecesarias ni frases rígidas como "según lo solicitado", "estimado usuario" o "procedo a".',
    'No digas que vas a consultar ni pidas esperar; ya tienes el resultado.',
    'No inventes datos ausentes, correos, teléfonos, técnicos ni IDs.',
    'Si un campo no existe, escribe "Sin asignar" solo para técnico; omite otros campos ausentes.',
    'Mantén la respuesta breve, pero completa. Si hay un patrón evidente, menciónalo en una frase: por ejemplo, estados repetidos, tickets sin técnico o asuntos similares.',
    'Evita sonar excesivamente ceremonial. Puedes usar frases naturales como "Encontré esto", "Lo más relevante es..." o "Veo que...".',
    'Después del resultado, agrega un bloque final **Opciones** con 2 o 3 acciones contextuales que el usuario puede pedir para continuar.',
    'Las opciones deben ser concretas y accionables, por ejemplo: "Ver detalle del ticket #12345", "Filtrar por estado En Espera", "Buscar MCI por Líder de MCI" o "Crear una nueva solicitud".',
    'No ofrezcas acciones que no correspondan al resultado o a los permisos del usuario.'
  ];

  const ticketFormat = [
    'Para listas de tickets, usa este formato:',
    '**Resumen**',
    'Una o dos líneas naturales con el total, el criterio aplicado y cualquier patrón útil. Ejemplo: "Encontré 3 tickets cerrados. Dos corresponden a SAP y uno no tiene técnico asignado."',
    '',
    '**Tickets**',
    '| Ticket | Asunto | Estado | Prioridad | Técnico |',
    '|---|---|---|---|---|',
    '| #12345 | Asunto breve del ticket | Cerrado | Media | Kassim Acevedo |',
    '',
    'Muestra máximo 8 tickets en Teams y máximo 12 en web. Si hay más, indícalo al final.',
    'Para detalles de un solo ticket, usa una tabla de dos columnas: | Campo | Valor |.',
    'Mantén asuntos largos resumidos para que la tabla sea legible.',
    'Incluye descripción o resolución solo si el usuario la pidió o si es esencial para entender el estado.'
  ];

  const toolRules = toolName === 'sdp_get_request_details'
    ? [
        'Para detalle de ticket, no escribas tablas Markdown en una sola línea. Usa secciones breves: **Resumen**, **Detalle**, **Descripción** y **Opciones**.',
        'En **Detalle**, usa viñetas cortas de una línea por campo si el canal no garantiza tablas. Ejemplo: "- Estado: En Proceso".',
        'Las opciones deben orientar a ver resolución, agregar seguimiento, crear una solicitud relacionada o consultar tickets similares si aplica.'
      ]
    : toolName === 'sdp_search_user'
      ? [
          'Para búsqueda de usuario, las opciones deben orientar a consultar tickets como solicitante, consultar tickets como Técnico asignado o buscar MCI relacionadas.'
        ]
      : [
          'Para listas de tickets o MCI, las opciones deben orientar a abrir detalle por ID, refinar tickets por estado/prioridad/persona, refinar MCI por Líder de MCI/avance/predictiva, o continuar con una acción segura permitida.'
        ];

  const channelRules = channel === 'teams'
    ? [
        'Estás respondiendo en Microsoft Teams.',
        'Usa tablas Markdown compactas de máximo 5 columnas.',
        'Evita párrafos largos; cada bloque debe poder leerse en móvil.',
        'No sobreexpliques. Teams debe sentirse ágil.'
      ]
    : [
        'Estás respondiendo en la interfaz web.',
        'Puedes usar tablas pequeñas solo si tienen como máximo 4 columnas; para tickets, prefiere listas numeradas si ayudan a leer mejor.',
        'Puedes dar una explicación un poco más rica que en Teams, pero sin extenderte.'
      ];

  return [...base, ...channelRules, ...ticketFormat, ...toolRules].join('\n');
}

function createTicketsAdaptiveCard(toolOutput) {
  let data;
  try {
    data = JSON.parse(toolOutput);
  } catch {
    return null;
  }

  const requests = Array.isArray(data?.requests) ? data.requests : [];
  const totalRows = Number(data?.list_info?.row_count || requests.length || 0);
  const isMciResult = data?.result_type === 'mci';
  const itemLabel = isMciResult ? 'MCI' : 'ticket';
  const visibleRequests = requests.slice(0, 8);
  const hasMoreRows = totalRows > 0 && (Boolean(data?.list_info?.has_more_rows) || requests.length > visibleRequests.length);
  const summaryText = `Encontré ${totalRows} ${itemLabel}${totalRows === 1 ? '' : 's'}.`;

  const headerValues = isMciResult
    ? ['MCI', 'Asunto', 'Líder', 'Avance', 'Predictiva', 'Actualización']
    : ['Ticket', 'Asunto', 'Estado', 'Prioridad', 'Técnico'];
  const headerRow = createTicketTableRow(headerValues, { isHeader: true });
  const rows = visibleRequests.map((request, index) => {
    const values = isMciResult
      ? [
          `#${request.id || '-'}`,
          truncateText(request.subject || 'Sin asunto', 64),
          getMciLeaderDisplayValue(request) || 'Sin asignar',
          getMciProgressValue(request) || '-',
          truncateText(getMciPredictiveValue(request) || '-', 24),
          getLastUpdatedValue(request) || '-'
        ]
      : [
          `#${request.id || '-'}`,
          truncateText(request.subject || 'Sin asunto', 64),
          getDisplayName(request.status) || '-',
          getDisplayName(request.priority) || '-',
          getDisplayName(request.technician) || 'Sin asignar'
        ];
    return createTicketTableRow(values, { shade: index % 2 === 1 });
  });

  const body = [
    {
      type: 'TextBlock',
      text: isMciResult ? 'MCI encontradas' : 'Tickets encontrados',
      weight: 'Bolder',
      size: 'Medium',
      wrap: true
    },
    {
      type: 'TextBlock',
      text: summaryText,
      isSubtle: true,
      spacing: 'Small',
      wrap: true
    },
    headerRow,
    ...rows
  ];

  if (isMciResult) {
    const commentLines = visibleRequests
      .map((request) => {
        const comment = getMciCommentValue(request);
        return comment ? `#${request.id || '-'}: ${truncateText(comment, 120)}` : null;
      })
      .filter(Boolean);
    if (commentLines.length > 0) {
      body.push({
        type: 'TextBlock',
        text: `Comentarios\n${commentLines.map((line) => `- ${line}`).join('\n')}`,
        wrap: true,
        spacing: 'Medium',
        isSubtle: true
      });
    }
  }

  if (hasMoreRows) {
    body.push({
      type: 'TextBlock',
      text: 'Hay más resultados disponibles. Puedes pedirme un estado, usuario o criterio más específico.',
      isSubtle: true,
      wrap: true,
      spacing: 'Medium'
    });
  }

  body.push(createResultOptionsBlock({ isMciResult, hasResults: visibleRequests.length > 0 }));

  if (visibleRequests.length === 0) {
    body.splice(2, 1, {
      type: 'TextBlock',
      text: isMciResult ? 'No encontré MCI para ese criterio.' : 'No encontré tickets para ese criterio.',
      wrap: true,
      spacing: 'Medium'
    });
  }

  return {
    type: 'adaptive_card',
    summaryText,
    card: {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type: 'AdaptiveCard',
      version: '1.4',
      body
    }
  };
}

function createResultOptionsBlock({ isMciResult, hasResults }) {
  const options = hasResults
    ? isMciResult
      ? [
          'Muéstrame el detalle de la MCI #12345',
          'Filtra estas MCI por Líder, estado, avance o predictiva',
          'Actualiza el avance de una MCI autorizada'
        ]
      : [
          'Muéstrame el detalle del ticket #12345',
          'Filtra por estado, prioridad, solicitante o Técnico asignado',
          'Crea una solicitud relacionada'
        ]
    : isMciResult
      ? [
          'Busca MCI por solicitante',
          'Busca MCI por Líder de MCI',
          'Consulta MCI en otro estado'
        ]
      : [
          'Busca tickets por solicitante',
          'Busca tickets por Técnico asignado',
          'Consulta tickets cerrados o en espera'
        ];

  return {
    type: 'Container',
    spacing: 'Medium',
    separator: true,
    items: [
      {
        type: 'TextBlock',
        text: 'Opciones',
        weight: 'Bolder',
        wrap: true
      },
      {
        type: 'TextBlock',
        text: options.map((option) => `- ${option}`).join('\n'),
        wrap: true,
        spacing: 'Small',
        isSubtle: true
      }
    ]
  };
}

function getMciProgressValue(request) {
  const value = request?.udf_fields?.udf_long_1801;
  if (value === undefined || value === null || value === '') return '';
  const displayValue = getDisplayName(value) || String(value);
  return /%$/.test(displayValue.trim()) ? displayValue : `${displayValue}%`;
}

function getMciLeaderDisplayValue(request) {
  return getDisplayName(request?.udf_fields?.udf_pick_1503);
}

function getMciPredictiveValue(request) {
  return getDisplayName(request?.udf_fields?.udf_sline_2102) || String(request?.udf_fields?.udf_sline_2102 || '');
}

function getLastUpdatedValue(request) {
  return getDisplayDate(
    request?.last_updated_time ||
    request?.updated_time ||
    request?.last_update_time ||
    request?.modified_time ||
    request?.edit_time
  );
}

function getMciCommentValue(request) {
  return stripHtml(
    request?.comments ||
    request?.comment ||
    request?.status_change_comments ||
    request?.requester_comments ||
    request?.technician_comments ||
    ''
  ).trim();
}

function createTicketDetailsAdaptiveCard(toolOutput) {
  let data;
  try {
    data = JSON.parse(toolOutput);
  } catch {
    return null;
  }

  const request = data?.request || data;
  if (!request?.id) return null;

  const ticketId = `#${request.id}`;
  const subject = request.subject || 'Sin asunto';
  const summaryText = `Detalle del ticket ${ticketId}`;
  const rows = [
    ['Estado', getDisplayName(request.status) || '-'],
    ['Prioridad', getDisplayName(request.priority) || '-'],
    ['Categoría', getDisplayName(request.category) || '-'],
    ['Subcategoría', getDisplayName(request.subcategory) || '-'],
    ['Tipo', getDisplayName(request.request_type) || '-'],
    ['Solicitante', getDisplayName(request.requester) || '-'],
    ['Técnico', getDisplayName(request.technician) || 'Sin asignar'],
    ['Creado', getDisplayDate(request.created_time) || '-'],
    ['Vence', getDisplayDate(request.due_by_time) || '-']
  ];
  const description = stripHtml(request.description || request.short_description || '');
  const resolution = stripHtml(getResolutionText(request.resolution));

  const body = [
    {
      type: 'TextBlock',
      text: `Ticket ${ticketId}`,
      weight: 'Bolder',
      size: 'Medium',
      wrap: true
    },
    {
      type: 'TextBlock',
      text: subject,
      wrap: true,
      spacing: 'Small'
    },
    {
      type: 'Container',
      spacing: 'Medium',
      separator: true,
      items: rows.map(([label, value]) => createDetailFactRow(label, value))
    }
  ];

  if (description) {
    body.push(createDetailTextBlock('Descripción', description));
  }

  if (resolution) {
    body.push(createDetailTextBlock('Resolución', resolution));
  }

  body.push(createDetailOptionsBlock(ticketId, request));

  return {
    type: 'adaptive_card',
    summaryText,
    card: {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type: 'AdaptiveCard',
      version: '1.4',
      body
    }
  };
}

function getResolutionText(resolution) {
  if (!resolution) return '';
  if (typeof resolution === 'string') return resolution;
  if (typeof resolution !== 'object') return String(resolution);
  return resolution.content
    || resolution.description
    || resolution.text
    || resolution.display_value
    || resolution.name
    || '';
}

function createDetailFactRow(label, value) {
  return {
    type: 'ColumnSet',
    spacing: 'Small',
    columns: [
      {
        type: 'Column',
        width: '110px',
        items: [
          {
            type: 'TextBlock',
            text: label,
            weight: 'Bolder',
            isSubtle: true,
            wrap: true,
            size: 'Small'
          }
        ]
      },
      {
        type: 'Column',
        width: 'stretch',
        items: [
          {
            type: 'TextBlock',
            text: String(value || '-'),
            wrap: true,
            size: 'Small'
          }
        ]
      }
    ]
  };
}

function createDetailTextBlock(title, text) {
  return {
    type: 'Container',
    spacing: 'Medium',
    separator: true,
    items: [
      {
        type: 'TextBlock',
        text: title,
        weight: 'Bolder',
        wrap: true
      },
      {
        type: 'TextBlock',
        text: truncateText(redactSensitiveText(text), 900),
        wrap: true,
        spacing: 'Small'
      }
    ]
  };
}

function createDetailOptionsBlock(ticketId, request) {
  const category = getDisplayName(request.category);
  const options = [
    `Agregar un seguimiento al ticket ${ticketId}`,
    category ? `Ver tickets similares de ${category}` : 'Ver tickets similares',
    'Crear una nueva solicitud relacionada'
  ];

  return {
    type: 'Container',
    spacing: 'Medium',
    separator: true,
    items: [
      {
        type: 'TextBlock',
        text: 'Opciones',
        weight: 'Bolder',
        wrap: true
      },
      {
        type: 'TextBlock',
        text: options.map((option) => `- ${option}`).join('\n'),
        wrap: true,
        spacing: 'Small',
        isSubtle: true
      }
    ]
  };
}

function createTicketTableRow(values, options = {}) {
  const widths = ['auto', 'stretch', 'auto', 'auto', 'auto'];
  return {
    type: 'Container',
    style: options.isHeader ? 'emphasis' : options.shade ? 'accent' : 'default',
    bleed: false,
    spacing: options.isHeader ? 'Medium' : 'Small',
    items: [
      {
        type: 'ColumnSet',
        columns: values.map((value, index) => ({
          type: 'Column',
          width: widths[index] || 'auto',
          items: [
            {
              type: 'TextBlock',
              text: String(value || '-'),
              weight: options.isHeader ? 'Bolder' : 'Default',
              wrap: true,
              size: 'Small'
            }
          ]
        }))
      }
    ]
  };
}

function getDisplayName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.name || value.display_value || value.value || '';
}

function getDisplayDate(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.display_value || value.value || value.name || '';
}

async function assertToolAllowedForUser(toolName, args, user) {
  if (!REQUEST_SCOPED_MUTATION_TOOLS.has(toolName)) return;

  const requestId = args?.request_id;
  if (!requestId || requestId === 'AUTO') {
    throw new Error('Esta acción requiere un ID de ticket real y verificable.');
  }

  const details = await callMcpTool('sdp_get_request_details', { request_id: requestId });
  const data = JSON.parse(details.content[0].text);

  if (toolName === 'sdp_update_mci') {
    if (!isMciRequestData(data)) {
      throw new Error('Ese ticket no corresponde a una MCI.');
    }

    if (mciUpdateChangesLeader(args) && !isMciAdmin(user)) {
      throw new Error('Solo un administrador MCI puede cambiar el líder de una MCI.');
    }

    if (!isMciAdmin(user) && !userMatchesMciLeader(user, data)) {
      throw new Error('Solo el líder de la MCI o un administrador MCI puede modificar esta MCI.');
    }

    if (!isMciAdmin(user)) {
      const disallowedFields = getDisallowedLeaderMciUpdateFields(args);
      if (disallowedFields.length > 0) {
        throw new Error(`Como líder de MCI puedes modificar fecha de actualización, descripción, predictiva y porcentaje de avance. Campos no permitidos: ${disallowedFields.join(', ')}.`);
      }
    }

    return;
  }

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

function getTeamsAllowedTenantIds() {
  return (process.env.TEAMS_ALLOWED_TENANT_IDS || process.env.AZURE_TENANT_ID || process.env.MICROSOFT_TENANT_ID || '')
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
    const user = withUserRole(await enrichUserWithSdp({
      id: override.id,
      sdpRequesterId: override.sdpRequesterId || override.id,
      aadObjectId: activity?.from?.aadObjectId,
      role: override.role,
      isSupportAdmin: override.isSupportAdmin || override.admin,
      name: override.name || activity?.from?.name,
      email: override.email
    }));
    cacheTeamsUser(cacheKey, user);
    return user;
  }

  if (isGraphUserLookupEnabled() && activity?.from?.aadObjectId) {
    const graphUser = await fetchTeamsUserFromGraph(activity.from.aadObjectId);
    if (graphUser) {
      const user = withUserRole(await enrichUserWithSdp({
        aadObjectId: activity?.from?.aadObjectId,
        name: graphUser.displayName || activity?.from?.name,
        email: graphUser.mail || graphUser.userPrincipalName
      }));
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
  if (text?.type === 'adaptive_card') {
    const card = text.card;
    console.log(`[Teams] Enviando Adaptive Card a conversation=${context.activity?.conversation?.id || 'unknown'}`);
    try {
      const result = await Promise.race([
        context.sendActivity({
          type: 'message',
          text: text.summaryText || 'Resultado de Sophia',
          attachments: [
            {
              contentType: 'application/vnd.microsoft.card.adaptive',
              content: card
            }
          ]
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout enviando tarjeta a Teams')), 15000))
      ]);
      await auditTeamsEvent(context.activity, 'reply_sent', {
        replyLength: text.summaryText?.length || 0,
        replyPreview: createAuditTextPreview(text.summaryText || 'Resultado de Sophia'),
        cardPreview: createAdaptiveCardPreview(card),
        resourceId: result?.id,
        format: 'adaptive_card'
      });
      return result;
    } catch (error) {
      console.error('[Teams] Error enviando Adaptive Card:', error);
      await auditTeamsEvent(context.activity, 'reply_error', {
        error: truncateText(error.message, 300),
        cardPreview: createAdaptiveCardPreview(card),
        format: 'adaptive_card'
      });
      throw error;
    }
  }

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
      replyPreview: createAuditTextPreview(content),
      resourceId: result?.id
    });
    return result;
  } catch (error) {
    console.error('[Teams] Error enviando respuesta:', error);
    await auditTeamsEvent(context.activity, 'reply_error', {
      error: truncateText(error.message, 300),
      replyPreview: createAuditTextPreview(content)
    });
    throw error;
  }
}

async function handleTeamsMessage(context) {
  const allowedConversationIds = getTeamsAllowedConversationIds();
  const conversationId = context.activity?.conversation?.id;
  const allowedTenantIds = getTeamsAllowedTenantIds();
  const tenantId = context.activity?.conversation?.tenantId;
  const messagePreview = createTeamsActivityPreview(context.activity);

  if (allowedTenantIds.length > 0 && !allowedTenantIds.includes(tenantId)) {
    await auditTeamsEvent(context.activity, 'tenant_denied', { messagePreview });
    await sendTeamsReply(context, 'Este bot de soporte IT solo está habilitado para usuarios del tenant corporativo.');
    return;
  }

  if (allowedConversationIds.length > 0 && !allowedConversationIds.includes(conversationId)) {
    await auditTeamsEvent(context.activity, 'conversation_denied', { messagePreview });
    await sendTeamsReply(context, 'Este bot de soporte IT no está habilitado para este chat o canal de Teams.');
    return;
  }

  const text = getTeamsText(context.activity);
  if (!text) {
    await auditTeamsEvent(context.activity, 'empty_message_received', { messagePreview });
    await sendTeamsReply(context, 'Escríbeme tu consulta de soporte IT para ayudarte.');
    return;
  }

  const user = await resolveTeamsUser(context.activity);
  if (!user) {
    const aadObjectId = context.activity?.from?.aadObjectId || 'no disponible';
    await auditTeamsEvent(context.activity, 'user_not_mapped', { messagePreview });
    await sendTeamsReply(context,
      `Tu usuario de Teams aún no está vinculado a ServiceDesk Plus.\n\nAAD Object ID: ${aadObjectId}\nNombre: ${context.activity?.from?.name || 'no disponible'}\n\nAgrega este usuario en TEAMS_USER_OVERRIDES para habilitar tickets y consultas seguras.`
    );
    return;
  }

  await auditTeamsEvent(context.activity, 'message_received', {
    messagePreview,
    user: {
      name: user.name,
      emailDomain: getEmailDomain(user.email),
      sdpRequesterId: user.sdpRequesterId || user.id,
      role: user.role || (isSupportAdmin(user) ? 'support_admin' : 'user')
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
      await auditToolCall({ user, toolName: action.toolName, args: action.args, outcome: 'confirmed_error', error });
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
  await context.sendActivity({ type: 'typing' });
  await runSupportTurn({
    message: text,
    user,
    history: session.history,
    createPendingActionForUser: (action) => createPendingAction(session, action),
    onStatus: () => {},
    onText: (content) => chunks.push(content),
    onCard: (card) => chunks.push(card),
    onWorking: async (content) => {
      await context.sendActivity({ type: 'typing' });
      await sendTeamsReply(context, content);
    },
    onConfirmationRequired: () => chunks.push('\n\nResponde **CONFIRMAR** para ejecutar esta acción o **CANCELAR** para descartarla.'),
    streamSummary: false,
    responseChannel: 'teams'
  });

  const cardResponse = chunks.find((chunk) => chunk?.type === 'adaptive_card');
  if (cardResponse) {
    session.history = pushChatHistory(pushChatHistory(session.history, 'user', text), 'assistant', cardResponse.summaryText);
    await sendTeamsReply(context, cardResponse);
    return;
  }

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
    if (!userCanReadRequest(req.user, data)) {
      return res.status(403).json({ success: false, message: 'No tienes permiso para consultar ese ticket.' });
    }
    res.json(data);
  } catch (error) {
    console.error("Error consultando ticket via MCP:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/list-requests', requireAuth, async (req, res) => {
  const { filter_by, limit, scope } = req.body;
  const scopedRequesterId = getRequesterId(req.user);

  if (!scopedRequesterId) {
    return res.status(403).json({ success: false, message: 'Tu usuario no está vinculado a un solicitante de ServiceDesk Plus.' });
  }

  try {
    const args = {
      filter_by: filter_by || "All_Requests",
      limit: limit || 20
    };

    if (!isSupportAdmin(req.user) || scope !== 'all') {
      args.requester_id = scopedRequesterId;
    }

    const result = await mcpClient.request(
      {
        method: "tools/call",
        params: {
          name: "sdp_list_requests",
          arguments: args
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

app.get('/api/rag/search', requireAuth, async (req, res) => {
  const query = String(req.query.q || '').trim();
  const limit = Number(req.query.limit || process.env.RAG_TOP_K || 5);
  const minScore = req.query.minScore === undefined
    ? Number(process.env.RAG_MIN_SCORE || 0.68)
    : Number(req.query.minScore);

  if (!query) {
    return res.status(400).json({ success: false, message: 'Debes enviar una consulta en el parámetro q.' });
  }

  try {
    const results = await searchKnowledge(query, {
      role: isSupportAdmin(req.user) ? 'support_admin' : req.user?.role || 'user',
      limit,
      minScore
    });

    res.json({
      success: true,
      query,
      count: results.length,
      role: isSupportAdmin(req.user) ? 'support_admin' : req.user?.role || 'user',
      results: results.map((result) => ({
        id: result.id,
        title: result.title,
        source: result.source,
        docType: result.docType,
        area: result.area,
        visibility: result.visibility,
        score: Number(result.score.toFixed(4)),
        content: result.content
      }))
    });
  } catch (error) {
    console.error('[RAG] Error consultando diagnóstico:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/rag/classify-ticket', requireAuth, async (req, res) => {
  const { subject, description, message, text } = req.body || {};
  const hasInput = [subject, description, message, text].some((value) => String(value || '').trim());

  if (!hasInput) {
    return res.status(400).json({
      success: false,
      message: 'Debes enviar subject, description, message o text para clasificar el ticket.'
    });
  }

  try {
    const classification = await classifyTicketWithKnowledge({ subject, description, message, text }, req.user);
    res.json({
      success: true,
      input: {
        subject: subject || null,
        description: description || message || text || null
      },
      classification
    });
  } catch (error) {
    console.error('[RAG] Error clasificando ticket:', error);
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
    const createArgs = {
      subject,
      description,
      category,
      subcategory,
      priority,
      request_type: "Solicitud",
      requester: req.user?.name,
      requester_id: getRequesterId(req.user)
    };
    const classification = await classifyTicketWithKnowledge(createArgs, req.user);
    applyTicketClassificationToArgs(createArgs, classification);
    sanitizeCreateRequestArgs(createArgs);

    const result = await mcpClient.request(
      {
        method: "tools/call",
        params: {
          name: "sdp_create_request",
          arguments: createArgs
        },
      },
      CallToolResultSchema
    );

    const data = JSON.parse(result.content[0].text);
    const createdRequestId = extractRequestIdFromToolResult(result);
    await auditToolCall({
      user: req.user,
      toolName: 'sdp_create_request',
      args: createdRequestId ? { ...createArgs, request_id: createdRequestId } : createArgs,
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
    await auditToolCall({ user: req.user, toolName: action.toolName, args: action.args, outcome: 'confirmed_error', error });
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
      onWorking: (content) => {
        sendEvent('status', { message: 'Sophia está trabajando en tu solicitud...' });
        sendEvent('text', { content: `${content}\n\n` });
      },
      onConfirmationRequired: (data) => sendEvent('confirmation_required', data),
      streamSummary: true,
      responseChannel: 'web'
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
      if (message?.type === 'typing') return;
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
      allowedTenants: getTeamsAllowedTenantIds().length,
      allowedConversations: getTeamsAllowedConversationIds().length,
      supportAdmins: getCsvEnvSet('TEAMS_ADMIN_AAD_OBJECT_IDS').size
        + getCsvEnvSet('SUPPORT_ADMIN_EMAILS').size
        + getCsvEnvSet('SUPPORT_ADMIN_SDP_REQUESTER_IDS').size,
      userOverrides: Object.keys(overrides).length
    }
  });
});

app.listen(PORT, () => {
  console.log(`Chatbot Backend Bridge corriendo en http://localhost:${PORT}`);
  initMCP();
});
