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
import { appendFile, mkdir, readFile, rename, writeFile } from 'fs/promises';
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
const RUNTIME_STATE_PATH = process.env.RUNTIME_STATE_PATH || path.join(__dirname, 'data', 'runtime-state.json');
const sessions = new Map();
const teamsSessions = new Map();
const teamsUserCache = new Map();
const graphTokenCache = { accessToken: null, expiresAt: 0 };
let runtimeStateSaveTimer = null;
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
    if (token) {
      sessions.delete(token);
      scheduleRuntimeStateSave();
    }
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

function serializeSession(session) {
  return {
    user: session.user,
    history: normalizeChatHistory(session.history || []),
    operationalMemory: sanitizeOperationalMemory(session.operationalMemory),
    expiresAt: session.expiresAt,
    pendingActions: [...(session.pendingActions || new Map()).entries()].map(([id, action]) => ({
      id,
      ...action
    }))
  };
}

function deserializeSession(value) {
  if (!value || value.expiresAt <= Date.now()) return null;
  const pendingActions = new Map();
  for (const action of value.pendingActions || []) {
    if (!action?.id || action.expiresAt <= Date.now()) continue;
    pendingActions.set(action.id, {
      toolName: action.toolName,
      args: action.args || {},
      content: action.content || '',
      expiresAt: action.expiresAt
    });
  }
  return {
    user: withUserRole(value.user),
    history: normalizeChatHistory(value.history || []),
    operationalMemory: sanitizeOperationalMemory(value.operationalMemory),
    pendingActions,
    expiresAt: value.expiresAt
  };
}

async function loadRuntimeState() {
  try {
    const text = await readFile(RUNTIME_STATE_PATH, 'utf8');
    const state = JSON.parse(text);
    const now = Date.now();

    for (const [token, sessionValue] of Object.entries(state.sessions || {})) {
      const session = deserializeSession(sessionValue);
      if (session && session.expiresAt > now) sessions.set(token, session);
    }

    for (const [key, sessionValue] of Object.entries(state.teamsSessions || {})) {
      const session = deserializeSession(sessionValue);
      if (session && session.expiresAt > now) teamsSessions.set(key, session);
    }

    console.log(`[State] Estado runtime restaurado: web=${sessions.size}, teams=${teamsSessions.size}`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[State] No se pudo cargar el estado runtime:', error.message);
    }
  }
}

function scheduleRuntimeStateSave() {
  if (runtimeStateSaveTimer) return;
  runtimeStateSaveTimer = setTimeout(() => {
    runtimeStateSaveTimer = null;
    saveRuntimeState().catch((error) => {
      console.warn('[State] No se pudo guardar el estado runtime:', error.message);
    });
  }, 250);
}

async function saveRuntimeState() {
  pruneAllRuntimeSessions();
  const state = {
    version: 1,
    savedAt: new Date().toISOString(),
    sessions: Object.fromEntries([...sessions.entries()].map(([token, session]) => [token, serializeSession(session)])),
    teamsSessions: Object.fromEntries([...teamsSessions.entries()].map(([key, session]) => [key, serializeSession(session)]))
  };
  const tmpPath = `${RUNTIME_STATE_PATH}.tmp`;
  await mkdir(path.dirname(RUNTIME_STATE_PATH), { recursive: true });
  await writeFile(tmpPath, JSON.stringify(state, null, 2));
  await rename(tmpPath, RUNTIME_STATE_PATH);
}

function pruneAllRuntimeSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    prunePendingActions(session, false);
    if (session.expiresAt <= now) sessions.delete(token);
  }
  for (const [key, session] of teamsSessions.entries()) {
    prunePendingActions(session, false);
    if (session.expiresAt <= now) teamsSessions.delete(key);
  }
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
    operationalMemory: createEmptyOperationalMemory(),
    pendingActions: new Map()
  });
  scheduleRuntimeStateSave();
  return token;
}

function createEmptyOperationalMemory() {
  return {
    lastTicket: null,
    lastTicketList: null
  };
}

function sanitizeOperationalMemory(value = {}) {
  return {
    lastTicket: sanitizeTicketMemory(value.lastTicket),
    lastTicketList: sanitizeTicketListMemory(value.lastTicketList)
  };
}

function sanitizeTicketMemory(ticket) {
  if (!ticket?.id) return null;
  return {
    id: String(ticket.id),
    subject: truncateText(stripHtml(ticket.subject || ''), 160),
    status: truncateText(getDisplayName(ticket.status) || ticket.status || '', 80),
    priority: truncateText(getDisplayName(ticket.priority) || ticket.priority || '', 80),
    requester: truncateText(getDisplayName(ticket.requester) || ticket.requester || '', 120),
    technician: truncateText(getDisplayName(ticket.technician) || ticket.technician || '', 120),
    source: truncateText(ticket.source || 'unknown', 40),
    updatedAt: ticket.updatedAt || new Date().toISOString()
  };
}

function rememberLastTicket(session, ticket, source = 'unknown') {
  if (!session || !ticket?.id || isMciRequestData(ticket)) return;
  session.operationalMemory = sanitizeOperationalMemory(session.operationalMemory);
  session.operationalMemory.lastTicket = sanitizeTicketMemory({
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    requester: ticket.requester,
    technician: ticket.technician,
    source,
    updatedAt: new Date().toISOString()
  });
  scheduleRuntimeStateSave();
}

function sanitizeTicketListMemory(value) {
  if (!value || !Array.isArray(value.tickets)) return null;
  const tickets = value.tickets
    .map((ticket) => sanitizeTicketMemory(ticket))
    .filter(Boolean)
    .slice(0, 10);

  if (tickets.length === 0) return null;

  return {
    tickets,
    source: truncateText(value.source || 'list', 40),
    updatedAt: value.updatedAt || new Date().toISOString()
  };
}

function rememberLastTicketList(session, requests, source = 'list') {
  if (!session || !Array.isArray(requests)) return;
  const tickets = requests
    .filter((request) => request?.id && !isMciRequestData(request))
    .slice(0, 10)
    .map((request) => ({
      id: request.id,
      subject: request.subject,
      status: request.status,
      priority: request.priority,
      requester: request.requester,
      technician: request.technician,
      source,
      updatedAt: new Date().toISOString()
    }));

  if (tickets.length === 0) return;

  session.operationalMemory = sanitizeOperationalMemory(session.operationalMemory);
  session.operationalMemory.lastTicketList = sanitizeTicketListMemory({
    tickets,
    source,
    updatedAt: new Date().toISOString()
  });
  scheduleRuntimeStateSave();
}

function rememberLastTicketFromToolOutput(session, toolName, toolOutput) {
  if (!session || !toolOutput) return;

  let data;
  try {
    data = typeof toolOutput === 'string' ? JSON.parse(toolOutput) : toolOutput;
  } catch {
    return;
  }

  if (toolName === 'sdp_get_request_details') {
    const request = data?.request || data;
    rememberLastTicket(session, request, 'details');
    return;
  }

  if (toolName === 'sdp_list_requests') {
    const requests = Array.isArray(data?.requests) ? data.requests : [];
    const firstTicket = requests.find((request) => request?.id && !isMciRequestData(request));
    rememberLastTicket(session, firstTicket, 'list');
    rememberLastTicketList(session, requests, data?.result_type || 'list');
    return;
  }

  if (toolName === 'sdp_create_request') {
    const request = data?.request || data?.response?.request || data;
    const requestId = request?.id || request?.request_id || data?.operation?.details?.request_id;
    rememberLastTicket(session, { ...request, id: requestId }, 'created');
  }
}

function hasTicketReference(message = '') {
  const normalized = normalizeRoutingText(message);
  return /\b(ticket anterior|ultimo ticket|ultima solicitud|solicitud anterior|ese ticket|este ticket|el ticket|ticket reciente|recien creado|creado anteriormente)\b/.test(normalized);
}

function getLastTicketId(session) {
  return session?.operationalMemory?.lastTicket?.id || null;
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
  if (isSupportAdmin(user) || userCanAccessRequest(user, data) || userMatchesAssignedTechnician(user, data)) return true;
  return isMciRequestData(data) && userMatchesMciLeader(user, data);
}

function userCanSeeListRequest(user, request, { isMciResult = false } = {}) {
  if (isMciResult) return userCanReadRequest(user, request);
  return userCanAccessRequest(user, request) || userMatchesAssignedTechnician(user, request);
}

function userMatchesAssignedTechnician(user, data) {
  const request = data?.request || data;
  const assignedTechnician = normalizeComparableText(getAssignedTechnicianValue(request));
  if (!assignedTechnician) return false;

  const userCandidates = [
    user?.name,
    user?.email,
    user?.displayName,
    user?.mail,
    user?.userPrincipalName
  ].map(normalizeComparableText).filter(Boolean);

  return userCandidates.some((candidate) => (
    candidate === assignedTechnician ||
    assignedTechnician.includes(candidate) ||
    candidate.includes(assignedTechnician)
  ));
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

  if (args.fields && typeof args.fields === 'object') {
    minimized.fields = Object.fromEntries(
      Object.entries(args.fields).map(([key, value]) => [
        key,
        truncateText(redactSensitiveText(String(value)), 120)
      ])
    );
  }

  if (args.udf_fields && typeof args.udf_fields === 'object') {
    minimized.udf_fields = summarizeAuditUdfFields(args.udf_fields);
  }

  if (args.user_email || args.requester_email) {
    minimized.user_email_domain = getEmailDomain(args.user_email || args.requester_email);
  }

  if (args.sophia_classification) {
    minimized.sophia_classification = args.sophia_classification;
  }

  return minimized;
}

function summarizeAuditUdfFields(udfFields = {}) {
  return Object.fromEntries(
    Object.entries(udfFields).map(([key, value]) => [
      key,
      summarizeAuditUdfValue(value)
    ])
  );
}

function summarizeAuditUdfValue(value) {
  if (value && typeof value === 'object') {
    return {
      id: value.id ? redactSensitiveText(String(value.id)) : undefined,
      name: value.name ? redactSensitiveText(String(value.name)) : undefined,
      value: value.value ? redactSensitiveText(String(value.value)) : undefined,
      display_value: value.display_value ? redactSensitiveText(String(value.display_value)) : undefined
    };
  }
  return redactSensitiveText(String(value ?? ''));
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

function prunePendingActions(session, persist = true) {
  const now = Date.now();
  const expiredActions = [];
  for (const [id, action] of session.pendingActions.entries()) {
    if (action.expiresAt <= now) {
      session.pendingActions.delete(id);
      expiredActions.push({ id, action });
    }
  }
  if (expiredActions.length > 0 && persist) scheduleRuntimeStateSave();
  return expiredActions;
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
  scheduleRuntimeStateSave();
  return actionId;
}

function takePendingAction(session, actionId) {
  const expiredActions = prunePendingActions(session);
  const expiredAction = expiredActions.find((entry) => entry.id === actionId);
  if (expiredAction) {
    return { expired: true, action: expiredAction.action };
  }
  const action = session.pendingActions.get(actionId);
  if (!action) return { expired: false, action: null };
  session.pendingActions.delete(actionId);
  scheduleRuntimeStateSave();
  return { expired: false, action };
}

function takeFirstPendingAction(session) {
  const expiredActions = prunePendingActions(session);
  const pending = [...session.pendingActions.keys()][0];
  if (pending) return takePendingAction(session, pending);

  const latestExpired = expiredActions.at(-1)?.action || null;
  return { expired: Boolean(latestExpired), action: latestExpired };
}

function formatExpiredConfirmationMessage(action) {
  const actionLabel = getPendingActionLabel(action);
  return [
    `La confirmación${actionLabel ? ` para ${actionLabel}` : ''} expiró por seguridad.`,
    'Vuelve a pedirme el cambio y lo preparo otra vez para que puedas confirmarlo.'
  ].join(' ');
}

function formatConfirmedActionError(action, error) {
  const minimizedError = minimizeAuditError(error);
  const fields = minimizedError?.fields || [];

  if (action?.toolName === 'sdp_create_request' && fields.includes('udf_pick_2701')) {
    return [
      'No pude crear la solicitud porque ServiceDesk Plus rechazó un campo interno obligatorio: Técnico asignado.',
      'No necesitas indicar tipo de activo ni ubicación para resolver esto; es un ajuste de configuración de Sophia/SDP.',
      'Voy a dejarlo registrado para revisión técnica. Puedes pedirme crear otra solicitud cuando validemos ese campo.'
    ].join('\n\n');
  }

  if (fields.length) {
    return `No pude ejecutar la acción confirmada porque ServiceDesk Plus pidió revisar estos campos: ${fields.join(', ')}.`;
  }

  return `No pude ejecutar la acción confirmada: ${error.message}`;
}

function getPendingActionLabel(action) {
  if (!action?.toolName) return '';
  const requestId = action.args?.request_id ? ` #${action.args.request_id}` : '';
  if (action.toolName === 'sdp_update_mci') return `actualizar la MCI${requestId}`;
  if (action.toolName === 'sdp_create_request') return 'crear la solicitud';
  if (action.toolName === 'sdp_update_request') return `actualizar el ticket${requestId}`;
  if (action.toolName === 'sdp_add_note') return `agregar seguimiento al ticket${requestId}`;
  if (action.toolName === 'sdp_resolve_request') return `resolver el ticket${requestId}`;
  if (action.toolName === 'sdp_assign_request') return `asignar el ticket${requestId}`;
  if (action.toolName === 'sdp_execute_automation_action') return 'ejecutar la acción técnica';
  return 'ejecutar la acción';
}

function createTeamsConfirmationCard({ actionId, toolName, args, user, intro, summaryText, expiresInMs }) {
  const expiresMinutes = Math.max(1, Math.round(Number(expiresInMs || PENDING_ACTION_TTL_MS) / 60000));
  const body = createTeamsConfirmationCardBody({ toolName, args, user, intro, summaryText, expiresMinutes });
  return {
    type: 'adaptive_card',
    summaryText: 'Confirmación requerida',
    card: {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type: 'AdaptiveCard',
      version: '1.4',
      body,
      actions: [
        {
          type: 'Action.Submit',
          title: 'Confirmar',
          style: 'positive',
          data: {
            action: 'sophia_confirm',
            actionId,
            toolName,
            msteams: {
              type: 'messageBack',
              displayText: 'Confirmar',
              text: `__sophia_confirm:${actionId}`,
              value: { action: 'sophia_confirm', actionId, toolName }
            }
          }
        },
        {
          type: 'Action.Submit',
          title: 'Cancelar',
          style: 'destructive',
          data: {
            action: 'sophia_cancel',
            actionId,
            toolName,
            msteams: {
              type: 'messageBack',
              displayText: 'Cancelar',
              text: `__sophia_cancel:${actionId}`,
              value: { action: 'sophia_cancel', actionId, toolName }
            }
          }
        }
      ]
    }
  };
}

function createTeamsConfirmationCardBody({ toolName, args = {}, user, intro, summaryText, expiresMinutes }) {
  const body = [
    {
      type: 'TextBlock',
      text: 'Confirmación requerida',
      weight: 'Bolder',
      size: 'Medium',
      wrap: true
    }
  ];

  if (intro) {
    body.push({
      type: 'TextBlock',
      text: truncateText(stripHtml(intro), 500),
      wrap: true,
      spacing: 'Small'
    });
  }

  if (toolName === 'sdp_create_request') {
    body.push(createCreateRequestConfirmationBlock(args, user));
  } else if (toolName === 'sdp_update_mci') {
    body.push(createMciUpdateConfirmationBlock(args));
  } else {
    body.push({
      type: 'TextBlock',
      text: truncateText(stripHtml(summaryText || 'Preparé la acción solicitada.'), 900),
      wrap: true,
      spacing: 'Small'
    });
  }

  body.push({
    type: 'TextBlock',
    text: `Por seguridad, esta confirmación vence en ${expiresMinutes} minutos.`,
    wrap: true,
    spacing: 'Small',
    isSubtle: true,
    size: 'Small'
  });

  return body;
}

function createCreateRequestConfirmationBlock(args = {}, user) {
  const assignedTechnician = getDisplayName(args.udf_fields?.udf_pick_2701) || args.udf_fields?.udf_pick_2701 || '-';
  const rows = [
    ['Asunto', args.subject || 'Sin asunto'],
    ['Categoría', args.category || '-'],
    ['Subcategoría', args.subcategory || '-'],
    ['Prioridad', args.priority || '-'],
    ['Tipo', args.request_type || '-'],
    ['Técnico asignado', assignedTechnician],
    ['Solicitante', user?.name || args.requester || '-']
  ];
  const classification = args.sophia_classification || {};
  const items = [
    {
      type: 'TextBlock',
      text: 'Solicitud preparada',
      weight: 'Bolder',
      wrap: true
    },
    ...rows.map(([label, value]) => createDetailFactRow(label, value))
  ];

  if (classification.routing || classification.confidence) {
    items.push(
      {
        type: 'TextBlock',
        text: 'Clasificación Sophia',
        weight: 'Bolder',
        wrap: true,
        spacing: 'Medium'
      },
      createDetailFactRow('Ruta', classification.routing || '-'),
      createDetailFactRow('Confianza', classification.confidence || '-'),
      createDetailFactRow('Señales', (classification.matchedKeywords || []).join(', ') || '-')
    );
  }

  if (args.description) {
    items.push(createDetailTextBlock('Descripción', stripHtml(args.description)));
  }

  return {
    type: 'Container',
    spacing: 'Medium',
    separator: true,
    items
  };
}

function createMciUpdateConfirmationBlock(args = {}) {
  const rows = [['MCI', args.request_id ? `#${args.request_id}` : '-']];
  const fieldLabels = {
    current_date: 'Fecha de actualización',
    description: 'Descripción',
    predictive: 'Predictiva',
    progress: 'Avance',
    status: 'Estado',
    stage: 'Etapa',
    previous_stage: 'Etapa anterior',
    due_date: 'Fecha tope',
    leader: 'Líder de MCI',
    mci_priority: 'Prioridad MCI',
    subject: 'Asunto'
  };

  for (const [field, value] of Object.entries(args.fields || {})) {
    rows.push([fieldLabels[field] || field, formatConfirmationFieldValue(field, value)]);
  }

  return {
    type: 'Container',
    spacing: 'Medium',
    separator: true,
    items: [
      {
        type: 'TextBlock',
        text: 'Cambio preparado',
        weight: 'Bolder',
        wrap: true
      },
      ...rows.map(([label, value]) => createDetailFactRow(label, value))
    ]
  };
}

function formatConfirmationFieldValue(field, value) {
  if (field === 'progress' && value !== undefined && value !== null && value !== '') {
    return /%$/.test(String(value)) ? String(value) : `${value}%`;
  }
  if (isConfirmationDateField(field)) {
    return formatConfirmationDateValue(value);
  }
  if (typeof value === 'object' && value?.display_value) return value.display_value;
  if (typeof value === 'object' && value?.value) return value.value;
  return String(value ?? '-');
}

function isConfirmationDateField(field) {
  return ['current_date', 'start_date', 'due_date', 'previous_week'].includes(field);
}

function formatConfirmationDateValue(value) {
  if (typeof value === 'object' && value?.display_value) return value.display_value;
  const rawValue = typeof value === 'object' && value?.value !== undefined ? value.value : value;
  const numericValue = Number(rawValue);
  if (!Number.isNaN(numericValue) && numericValue > 0) {
    return new Intl.DateTimeFormat('es-PA', {
      timeZone: 'America/Panama',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date(numericValue));
  }
  return String(rawValue ?? '-');
}

function formatPendingActionSummary({ toolName, args, user, intro }) {
  if (toolName === 'sdp_create_request') {
    return formatCreateRequestConfirmation(args, user, intro);
  }

  return `${intro || 'Preparé la acción solicitada.'}\n\nPara proteger tus tickets y accesos, esta acción requiere confirmación explícita antes de ejecutarse.`;
}

function formatCreateRequestConfirmation(args = {}, user, intro) {
  const classification = args.sophia_classification || {};
  const assignedTechnician = getDisplayName(args.udf_fields?.udf_pick_2701) || args.udf_fields?.udf_pick_2701 || '-';
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
    `| Técnico asignado | ${escapeMarkdownTableValue(assignedTechnician)} |`,
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
  if (isPersonalKeywordTicketSearchRequest(message) && aiDecision?.action !== 'call_tool') {
    aiDecision.action = 'call_tool';
    aiDecision.tool_name = 'sdp_list_requests';
    aiDecision.tool_args = {
      filter_by: 'All_Requests'
    };
    aiDecision.content = 'Claro, busco en tus tickets por esa palabra clave y te muestro los primeros resultados en orden cronológico.';
  }

  if (isStaleTicketsRequest(message) && aiDecision?.action !== 'call_tool') {
    aiDecision.action = 'call_tool';
    aiDecision.tool_name = 'sdp_list_requests';
    aiDecision.tool_args = {
      filter_by: 'Open_Requests'
    };
    aiDecision.content = 'Claro, reviso los tickets abiertos y te marco cuáles llevan más tiempo sin actualización.';
  }

  if (shouldConvertUpdateRequestToNote(aiDecision, message)) {
    const toolArgs = aiDecision.tool_args || {};
    aiDecision.tool_name = 'sdp_add_note';
    aiDecision.tool_args = {
      request_id: toolArgs.request_id,
      note_text: toolArgs.note_text ||
        toolArgs.notes ||
        toolArgs.comment ||
        toolArgs.fields?.note_text ||
        toolArgs.fields?.notes ||
        toolArgs.fields?.comment ||
        extractFollowUpTextFromMessage(message),
      is_public: toolArgs.is_public ?? true
    };
  }

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

function shouldConvertUpdateRequestToNote(aiDecision, message = '') {
  if (aiDecision?.tool_name !== 'sdp_update_request') return false;
  const args = aiDecision.tool_args || {};
  const fields = args.fields || {};
  return Boolean(
    args.note_text ||
    args.notes ||
    args.comment ||
    fields.note_text ||
    fields.notes ||
    fields.comment ||
    /\b(seguimiento|comentario|nota|evidencia|agrega esto|anade esto|añade esto)\b/i.test(message)
  );
}

function extractFollowUpTextFromMessage(message = '') {
  const text = String(message || '').trim();
  const split = text.split(/:\s+/);
  if (split.length > 1) return split.slice(1).join(': ').trim();
  return text.replace(/\b(agrega|añade|anade|registra)\b\s+(un\s+)?(seguimiento|comentario|nota|evidencia)\b/i, '').trim();
}

async function prepareToolArgs(toolName, toolArgs, user, message = '', session = null) {
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

    const assignedTechnicianSelfScope = getSelfAssignedTechnicianScope(user, args, message);
    if (!isSupportAdmin(user) || isPersonalTicketsRequest(message)) {
      if (assignedTechnicianSelfScope && !isMciListRequest(message)) {
        args.assigned_technician_name = assignedTechnicianSelfScope;
        delete args.requester_id;
      } else if (hasAssignedTechnicianScope(message) && args.assigned_technician_name && !assignedTechnicianSelfScope && !isMciListRequest(message)) {
        throw new Error('Por seguridad, solo puedes consultar tickets asignados a tu propio usuario como técnico.');
      } else if (isMciListRequest(message) && !hasRequesterScope(message)) {
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
    if ((isMciListRequest(message) && !hasAssignedTechnicianScope(message)) || (!isSupportAdmin(user) && !getSelfAssignedTechnicianScope(user, args, message))) {
      delete args.assigned_technician_name;
    }
    delete args.assigned_technician;
    delete args.mci_leader;
    delete args.leader_name;
    delete args.leader;
    if (isMciListRequest(message)) {
      args.mci_only = true;
    }
    if (isPersonalKeywordTicketSearchRequest(message)) {
      args.filter_by = 'All_Requests';
      args.personal_keyword_search = true;
      args.keyword = extractTicketKeywordFromMessage(message);
      args.limit = Math.max(Number(args.limit) || 0, Number(process.env.SOPHIA_KEYWORD_TICKET_SEARCH_LIMIT || 50));
      args.fields_required = mergeFieldsRequired(args.fields_required, [
        'subject',
        'status',
        'priority',
        'technician',
        'requester',
        'created_time',
        'due_by_time',
        'category',
        'subcategory'
      ]);
    }
    if (isStaleTicketsRequest(message)) {
      args.filter_by = 'Open_Requests';
      args.stale_only = true;
      args.stale_days = inferStaleDaysFromMessage(message) || Number(process.env.SOPHIA_STALE_TICKET_DAYS || 3);
      args.limit = Math.max(Number(args.limit) || 0, Number(process.env.SOPHIA_STALE_TICKET_LIMIT || 20));
      args.fields_required = mergeFieldsRequired(args.fields_required, [
        'subject',
        'status',
        'priority',
        'technician',
        'requester',
        'created_time',
        'due_by_time',
        'last_updated_time',
        'category'
      ]);
    }
    args.status = args.status || inferRequestStatusFromMessage(message);
    if (args.status) {
      delete args.filter_by;
    } else {
      delete args.status;
      args.filter_by = args.filter_by || inferRequestFilterFromMessage(message) || 'All_Requests';
    }
  }

  if (toolName === 'sdp_create_request' && user?.name) {
    args.requester = user.name;
    args.requester_id = getRequesterId(user);
    const classification = await classifyTicketWithKnowledge({ ...args, message }, user);
    applyTicketClassificationToArgs(args, classification, message);
    sanitizeCreateRequestArgs(args);
  }

  if (toolName === 'sdp_update_mci') {
    args.fields = normalizeMciUpdateFields(args.fields || args);
    applyRelativeMciDatesFromMessage(args.fields, message);
  }

  if (isTicketScopedTool(toolName)) {
    resolveTicketReferenceArgs(args, message, session);
  }

  if (toolName === 'sdp_add_note') {
    args.note_text = args.note_text || args.notes || args.comment || extractFollowUpTextFromMessage(message);
    args.is_public = args.is_public ?? true;
    delete args.notes;
    delete args.comment;
  }

  if (toolName === 'sdp_update_request' && args.status) {
    args.status = normalizeStatusValue(args.status);
  }

  if (toolName === 'sdp_execute_automation_action' && user?.email && !args.user_email) {
    args.user_email = user.email;
  }

  return args;
}

function isTicketScopedTool(toolName) {
  return [
    'sdp_get_request_details',
    'sdp_add_note',
    'sdp_resolve_request',
    'sdp_assign_request',
    'sdp_update_request'
  ].includes(toolName);
}

function resolveTicketReferenceArgs(args, message = '', session = null) {
  if (args.request_id) return;
  if (!hasTicketReference(message)) return;

  const lastTicketId = getLastTicketId(session);
  if (lastTicketId) {
    args.request_id = lastTicketId;
  }
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
    if (normalizedKey === 'progress') {
      normalized[normalizedKey] = parseMciProgressValue(value);
    } else if (normalizedKey === 'status') {
      normalized[normalizedKey] = normalizeStatusValue(value);
    } else {
      normalized[normalizedKey] = value;
    }
  }

  return normalized;
}

function parseMciProgressValue(value) {
  if (typeof value === 'number') return value;
  const normalized = String(value || '')
    .trim()
    .replace(/,/g, '.')
    .replace(/\s*(%|por\s+ciento|percent|percentage)\s*$/i, '');
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? value : parsed;
}

function normalizeStatusValue(status) {
  if (!status) return status;
  const normalized = String(status).trim().toLowerCase();
  
  if (/\b(cancelad[oa]s?|cancelled|cancelar)\b/i.test(normalized)) {
    return 'Cancelled';
  }
  if (/\b(abiert[oa]s?|open|abrir)\b/i.test(normalized)) {
    return 'Abierto';
  }
  if (/\b(en espera|on\s*hold|espera)\b/i.test(normalized)) {
    return 'En Espera';
  }
  if (/\b(en proceso|in\s*progress|proceso)\b/i.test(normalized)) {
    return 'En Proceso';
  }
  if (/\b(resuelt[oa]s?|resolved|resolver)\b/i.test(normalized)) {
    return 'Resuelto';
  }
  if (/\b(cerrad[oa]s?|closed|cerrar)\b/i.test(normalized)) {
    return 'Cerrado';
  }
  if (/\b(suspendid[oa]s?|suspended|suspender)\b/i.test(normalized)) {
    return 'Suspendido';
  }
  
  return status;
}

function applyRelativeMciDatesFromMessage(fields, message = '') {
  if (!fields || typeof fields !== 'object') return;
  if (!Object.prototype.hasOwnProperty.call(fields, 'current_date')) return;

  const normalizedMessage = normalizeComparableText(message);
  const dayMs = 24 * 60 * 60 * 1000;
  if (/\bhoy\b|\btoday\b/.test(normalizedMessage)) {
    fields.current_date = createSdpDateValue(Date.now());
  } else if (/\bayer\b|\byesterday\b/.test(normalizedMessage)) {
    fields.current_date = createSdpDateValue(Date.now() - dayMs);
  } else if (/\bmanana\b|\btomorrow\b/.test(normalizedMessage)) {
    fields.current_date = createSdpDateValue(Date.now() + dayMs);
  }
}

function createSdpDateValue(timestamp) {
  const date = new Date(timestamp);
  const localDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return { value: String(localDate.getTime()) };
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

function isStaleTicketsRequest(message = '') {
  const text = normalizeComparableText(message);
  return /\b(sin avance|sin actualizacion|sin movimiento|sin seguimiento|rezagad|estancad|necesitan seguimiento|requieren seguimiento|pendientes de seguimiento|sin cambios|sin novedad)\b/.test(text);
}

function inferStaleDaysFromMessage(message = '') {
  const text = normalizeComparableText(message);
  const explicit = text.match(/\b(?:mas de|mayor a|desde hace|hace)\s+(\d{1,2})\s+dias?\b/);
  if (explicit) return Number(explicit[1]);
  const plain = text.match(/\b(\d{1,2})\s+dias?\b/);
  if (plain) return Number(plain[1]);
  return null;
}

function mergeFieldsRequired(currentFields, requiredFields) {
  const fields = Array.isArray(currentFields) ? currentFields : [];
  return [...new Set([...fields, ...requiredFields])];
}

function isPersonalKeywordTicketSearchRequest(message = '') {
  const text = normalizeComparableText(message);
  if (!/\btickets?\b|\bsolicitudes?\b/.test(text)) return false;
  if (!/\b(mis|mios|mias|propios|propias|mi)\b/.test(text)) return false;
  return /\b(busca|buscar|buscame|encuentra|encontrar|filtra|filtrar|contengan|contiene|con la palabra|palabra clave|asunto|relacionad[oa]s? con)\b/.test(text);
}

function extractTicketKeywordFromMessage(message = '') {
  const raw = String(message || '').trim();
  const quoted = raw.match(/["'“”‘’]([^"'“”‘’]{2,80})["'“”‘’]/);
  if (quoted?.[1]) return quoted[1].trim();

  const patterns = [
    /\b(?:palabra clave|palabra|asunto)\s+(.+?)(?:\s+ordenad[oa]|\s+cronol[oó]gic|\s+primeros?\b|\s+ultimos?\b|$)/i,
    /\b(?:contengan|contiene|relacionad[oa]s?\s+con|sobre|de)\s+(.+?)(?:\s+ordenad[oa]|\s+cronol[oó]gic|\s+primeros?\b|\s+ultimos?\b|$)/i,
    /\b(?:busca|buscar|b[uú]scame|encuentra|encontrar|filtra|filtrar)\b.*?\b(?:mis\s+)?tickets?\b\s+(.+?)(?:\s+ordenad[oa]|\s+cronol[oó]gic|\s+primeros?\b|\s+ultimos?\b|$)/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return cleanTicketKeyword(match[1]);
  }

  return '';
}

function cleanTicketKeyword(value) {
  return String(value || '')
    .replace(/\b(?:por|basad[oa]s?\s+en|con|que|tengan|tiene|el|la|los|las|un|una|mis|mios|mías|mias|tickets?|solicitudes?|asunto|palabra|clave)\b/gi, ' ')
    .replace(/[?.!,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

function getSelfAssignedTechnicianScope(user, args = {}, message = '') {
  if (!hasAssignedTechnicianScope(message)) return null;

  const requestedTechnician = args.assigned_technician_name ||
    args.assigned_technician ||
    inferAssignedTechnicianNameFromMessage(message) ||
    user?.name ||
    user?.email;
  const normalizedRequested = normalizeComparableText(requestedTechnician);
  if (!normalizedRequested) return null;

  const userCandidates = [
    user?.name,
    user?.email,
    user?.displayName,
    user?.mail,
    user?.userPrincipalName
  ].map(normalizeComparableText).filter(Boolean);

  const matchesUser = userCandidates.some((candidate) => (
    candidate === normalizedRequested ||
    candidate.includes(normalizedRequested) ||
    normalizedRequested.includes(candidate)
  ));

  return matchesUser ? requestedTechnician : null;
}

function getAdminPersonScopeClarification(message, user) {
  if (!isSupportAdmin(user) || isPersonalTicketsRequest(message)) return null;
  if (isCreateTicketIntent(message)) return null;
  if (isTicketFollowUpIntent(message)) return null;
  if (!/\b(tickets?|solicitudes?|mci)\b/i.test(String(message || ''))) return null;
  if (isMciListRequest(message)) return null;
  if (hasRequesterScope(message) || hasAssignedTechnicianScope(message)) return null;

  const personName = extractRequesterNameFromMessage(message);
  if (!personName) return null;

  return `Para consultar a ${personName}, necesito aclarar el criterio de búsqueda: ¿quieres verlo como solicitante o en el campo Técnico asignado?`;
}

function isTicketFollowUpIntent(message) {
  return /\b(seguimiento|seguimientos|comentario|comentarios|nota|notas|evidencia|agrega esto|añade esto|anade esto|registrar seguimiento|agregar seguimiento|agregar una nota|agregar nota)\b/i.test(String(message || ''));
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

function applyTicketClassificationToArgs(args, classification, originalMessage = '') {
  const suggestion = classification?.suggestion || {};
  args.subject = args.subject || suggestion.subject;
  args.category = suggestion.category;
  args.subcategory = suggestion.subcategory;
  args.priority = resolveCreateRequestPriority(args, suggestion, originalMessage);
  args.request_type = suggestion.request_type;
  args.udf_fields = {
    ...(args.udf_fields || {}),
    ...(suggestion.udf_fields || {})
  };
  args.sophia_classification = summarizeTicketClassificationForAudit(classification);
}

function resolveCreateRequestPriority(args, suggestion, originalMessage = '') {
  const explicitPriority = inferExplicitPriorityFromText(originalMessage);
  if (explicitPriority) return explicitPriority;

  const combinedText = [
    originalMessage,
    args.subject,
    args.description
  ].filter(Boolean).join(' ');

  if (hasHighImpactPriorityEvidence(normalizeRoutingText(combinedText))) return 'Alta';

  const candidate = normalizePriority(args.priority) || normalizePriority(suggestion.priority);
  if (candidate === 'Alta') return 'Media';

  return candidate || 'Media';
}

function sanitizeCreateRequestArgs(args) {
  delete args.impact;
  delete args.urgency;
}

const SUPPORT_DIAGNOSTIC_PLAYBOOKS = [
  {
    routes: ['computer_monitor'],
    label: 'monitor o pantalla',
    signals: ['monitor', 'pantalla', 'display', 'lineas', 'líneas', 'rayas', 'sin imagen'],
    evidence: ['cable', 'hdmi', 'displayport', 'vga', 'otro monitor', 'segunda pantalla', 'reinicie', 'reinicié', 'probé', 'probe', 'parpadea', 'lineas', 'líneas', 'rayas', 'sin imagen', 'ubicacion', 'ubicación'],
    questions: [
      '¿El monitor enciende o queda totalmente sin imagen?',
      '¿Ya probaste otro cable/puerto o reiniciar el equipo?',
      '¿Aparecen líneas, parpadeo o algún mensaje en pantalla?'
    ]
  },
  {
    routes: ['internet_access', 'internet_slow', 'network_wifi', 'network_local', 'network_vpn'],
    label: 'red o internet',
    signals: ['internet', 'wifi', 'wi fi', 'red', 'vpn', 'conexion', 'conexión', 'lento', 'lentitud'],
    evidence: ['wifi', 'cable', 'vpn', 'ubicacion', 'ubicación', 'area', 'área', 'todos', 'varios', 'solo yo', 'solo mi', 'reinicie', 'reinicié', 'probé', 'probe', 'desde cuando', 'desde cuándo'],
    questions: [
      '¿Estás por WiFi, cable o VPN?',
      '¿Le ocurre solo a tu equipo o también a otros usuarios del área?',
      '¿Desde cuándo ocurre y en qué ubicación estás?'
    ]
  },
  {
    routes: ['printer'],
    label: 'impresora',
    signals: ['impresora', 'imprimir', 'zebra', 'honeywell', 'etiqueta', 'atascado'],
    evidence: ['modelo', 'zebra', 'honeywell', 'atasco', 'papel', 'etiqueta', 'cola', 'error', 'luces', 'ubicacion', 'ubicación', 'probé', 'probe', 'reinicie', 'reinicié'],
    questions: [
      '¿Qué modelo o ubicación tiene la impresora?',
      '¿Muestra algún error, luz o papel atascado?',
      '¿El problema ocurre con todos los usuarios o solo desde tu equipo?'
    ]
  },
  {
    routes: ['sap_access', 'sap', 'sap_reporting'],
    label: 'SAP',
    signals: ['sap', 'business one', 'b1', 'query', 'reporte', 'informe'],
    evidence: ['mensaje', 'error', 'modulo', 'módulo', 'usuario', 'ambiente', 'ruta', 'reporte', 'query', 'desde cuando', 'desde cuándo'],
    questions: [
      '¿Cuál es el mensaje de error exacto o la pantalla donde falla?',
      '¿En qué módulo, reporte o ruta de SAP ocurre?',
      '¿Te ocurre solo a ti o a más usuarios?'
    ]
  },
  {
    routes: ['peripheral_mouse', 'peripheral_keyboard', 'peripheral_audio', 'peripheral'],
    label: 'accesorio o periférico',
    signals: ['mouse', 'raton', 'ratón', 'teclado', 'audifono', 'audífono', 'headset', 'microfono', 'micrófono', 'periferico', 'periférico'],
    evidence: ['usb', 'bluetooth', 'bateria', 'batería', 'otro puerto', 'otro equipo', 'probé', 'probe', 'funciona intermitente', 'no enciende', 'dañado', 'danado'],
    questions: [
      '¿Es USB, Bluetooth o integrado al equipo?',
      '¿Ya probaste otro puerto o usarlo en otro equipo?',
      '¿Falla totalmente o funciona de forma intermitente?'
    ]
  },
  {
    routes: ['mobile_device'],
    label: 'celular corporativo',
    signals: ['celular', 'telefono', 'teléfono', 'movil', 'móvil', 'iphone', 'android'],
    evidence: ['modelo', 'pantalla', 'golpe', 'agua', 'no enciende', 'aplicacion', 'aplicación', 'linea', 'línea', 'sim', 'imei'],
    questions: [
      '¿Qué modelo de celular es?',
      '¿La falla es física, de encendido, de línea/SIM o de una aplicación?',
      '¿Hubo golpe, humedad o algún mensaje de error?'
    ]
  },
  {
    routes: ['password'],
    label: 'cuenta o contraseña',
    signals: ['contraseña', 'clave', 'password', 'bloqueada', 'bloqueado', 'login', 'iniciar sesion', 'iniciar sesión'],
    evidence: ['windows', 'sap', 'correo', 'vpn', 'ad', 'mensaje', 'bloqueado', 'vencida', 'expirada', 'usuario'],
    questions: [
      '¿El problema es con Windows/AD, SAP, correo, VPN u otro sistema?',
      '¿La cuenta aparece bloqueada, la contraseña venció o el sistema muestra otro mensaje?',
      '¿Necesitas desbloqueo o restablecimiento de contraseña?'
    ]
  }
];

function getCreateRequestDiagnosticPrompt({ toolName, args = {}, message = '', history = [] }) {
  if (toolName !== 'sdp_create_request') return null;

  const text = [
    message,
    args.subject,
    args.description
  ].filter(Boolean).join(' ');

  if (shouldBypassDiagnostic(message, history)) return null;

  const triagePrompt = getPriorityTriagePrompt({ message, preparedText: text, history });
  if (triagePrompt) return triagePrompt;

  const routeName = args.sophia_classification?.routing || resolveTicketRouting(args).name;
  const playbook = findDiagnosticPlaybook(routeName, text);
  if (!playbook) return null;

  if (hasEnoughDiagnosticEvidence(text, playbook)) return null;

  return [
    `Entiendo. Antes de crear el ticket de ${playbook.label}, necesito afinar un poco el diagnóstico para que llegue mejor clasificado y con datos útiles para el técnico.`,
    '',
    ...playbook.questions.map((question) => `- ${question}`),
    '',
    'Respóndeme con lo que sepas. Si el caso es urgente o prefieres registrarlo ya, dime **crear de todos modos** y preparo la solicitud con la información disponible.'
  ].join('\n');
}

function getPriorityTriagePrompt({ message = '', preparedText = '', history = [] }) {
  const normalizedMessage = normalizeRoutingText(message);
  const normalizedPreparedText = normalizeRoutingText(preparedText);
  if (inferPriorityFromText(message) || hasHighImpactPriorityEvidence(normalizedMessage) || hasPriorityTriageEvidence(normalizedPreparedText)) return null;

  const recentAssistant = normalizeChatHistory(history)
    .filter((entry) => entry.role === 'assistant')
    .slice(-2)
    .map((entry) => normalizeRoutingText(entry.content))
    .join(' ');

  if (recentAssistant.includes('calcular mejor la prioridad') || recentAssistant.includes('afecta solo a una persona')) {
    return null;
  }

  return [
    'Entiendo. Antes de preparar el ticket, necesito calcular mejor la prioridad para que soporte lo atienda con el nivel correcto.',
    '',
    '- ¿Afecta solo a una persona, a varios usuarios o a un área completa?',
    '- ¿Bloquea la operación o puedes seguir trabajando parcialmente?',
    '- ¿Impacta ventas, despacho, producción, facturación u otra operación crítica?',
    '- ¿Desde cuándo ocurre?',
    '',
    'Respóndeme con lo que sepas. Si quieres registrarlo ya, dime **crear de todos modos**.'
  ].join('\n');
}

function findDiagnosticPlaybook(routeName, text) {
  const normalizedText = normalizeRoutingText(text);
  return SUPPORT_DIAGNOSTIC_PLAYBOOKS.find((playbook) => playbook.routes.includes(routeName))
    || SUPPORT_DIAGNOSTIC_PLAYBOOKS.find((playbook) => playbook.signals.some((signal) => normalizedText.includes(normalizeRoutingText(signal))));
}

function hasEnoughDiagnosticEvidence(text, playbook) {
  const normalizedText = normalizeRoutingText(text);
  const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;
  const evidenceCount = playbook.evidence
    .filter((signal) => normalizedText.includes(normalizeRoutingText(signal)))
    .length;

  return wordCount >= 28 || evidenceCount >= 2 || hasPriorityTriageEvidence(normalizedText);
}

function hasPriorityTriageEvidence(normalizedText) {
  return countPriorityTriageSignals(normalizedText) >= 2;
}

function countPriorityTriageSignals(normalizedText) {
  return [
    /\b(solo yo|solo mi|solo a mi|solo mi equipo|mi equipo|una persona|un usuario|varios usuarios|todos|todo el area|toda el area|area completa|departamento completo|planta completa)\b/,
    /\b(bloquea|bloqueado|no puedo trabajar|no podemos trabajar|puedo seguir trabajando|seguir trabajando parcialmente|trabajando parcialmente|parcialmente|detenido|parado|fuera de servicio|sin operar)\b/,
    /\b(ventas|despacho|produccion|facturacion|caja|bodega|operacion|planta)\b/,
    /\b(desde hoy|desde ayer|desde hace|hace [0-9]+|esta manana|hoy en la manana|empezo hoy|inicio hoy|ayer|hoy)\b/
  ].filter((pattern) => pattern.test(normalizedText)).length;
}

function shouldBypassDiagnostic(text, history = []) {
  const normalizedText = normalizeRoutingText(text);
  if (/\b(crear de todos modos|registralo ya|regístralo ya|abrelo ya|ábrelo ya|sin diagnostico|sin diagnóstico|urgente|prioridad alta)\b/i.test(text)) {
    return true;
  }

  const recentAssistant = normalizeChatHistory(history)
    .filter((entry) => entry.role === 'assistant')
    .slice(-2)
    .map((entry) => normalizeRoutingText(entry.content))
    .join(' ');

  return recentAssistant.includes('antes de crear el ticket') &&
    recentAssistant.includes('crear de todos modos') &&
    normalizedText.split(/\s+/).filter(Boolean).length >= 3;
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
  normalizeCreateRequestUdfFields(args);
}

function normalizeCreateRequestUdfFields(args) {
  if (!args.udf_fields || typeof args.udf_fields !== 'object') {
    args.udf_fields = {};
    return;
  }

  args.udf_fields = Object.fromEntries(
    Object.entries(args.udf_fields)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
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
  const explicitPriority = inferExplicitPriorityFromText(text);
  if (explicitPriority) return explicitPriority;
  const normalized = normalizeRoutingText(text);
  if (hasHighImpactPriorityEvidence(normalized)) return 'Alta';
  return undefined;
}

function inferExplicitPriorityFromText(text) {
  const normalized = normalizeRoutingText(text);
  if (/\b(prioridad alta|alta prioridad|urgente|critico|critica)\b/.test(normalized)) return 'Alta';
  if (/\b(prioridad baja|baja prioridad)\b/.test(normalized)) return 'Baja';
  if (/\b(prioridad media|media prioridad|prioridad normal|normal)\b/.test(normalized)) return 'Media';
  return undefined;
}

function hasHighImpactPriorityEvidence(normalizedText) {
  const broadScope = /\b(varios usuarios|todos|todo el area|toda el area|area completa|departamento completo|planta completa)\b/.test(normalizedText);
  const operationBlocked = /\b(bloquea|bloqueado|no podemos trabajar|detenido|parado|fuera de servicio|sin operar|no funciona nada)\b/.test(normalizedText);
  const criticalOperation = /\b(ventas|despacho|produccion|facturacion|caja|bodega|operacion|planta)\b/.test(normalizedText);
  const explicitCriticalImpact = /\b(no podemos facturar|no puedo facturar|no podemos despachar|no puedo despachar|no podemos vender|no puedo vender|produccion detenida|produccion parada|facturacion detenida|despacho detenido)\b/.test(normalizedText);

  return explicitCriticalImpact || (operationBlocked && (broadScope || criticalOperation)) || (broadScope && criticalOperation);
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

function createSanitizedKnowledgeResponse(data) {
  const request = data?.request || data;
  if (!request?.id) return null;

  const status = getDisplayName(request.status);
  if (!isResolvedKnowledgeStatus(status)) return null;

  const resolution = redactKnowledgePeople(cleanKnowledgeText(getResolutionText(request.resolution), 900), request);
  const description = redactKnowledgePeople(cleanKnowledgeText(request.description || request.short_description || '', 600), request);
  if (!resolution && !description) return null;

  const subject = redactKnowledgePeople(cleanKnowledgeText(request.subject || '', 180), request)
    .replace(/^\s*\[persona-redacted\]\s*[-:]\s*/i, '')
    .trim();
  const category = getDisplayName(request.category);
  const subcategory = getDisplayName(request.subcategory);
  const classification = [category, subcategory].filter(Boolean).join(' / ');
  const lines = [
    `No puedo mostrar el detalle completo del ticket #${request.id} porque no pertenece a tu usuario, pero sí puedo compartir una versión sanitizada como referencia de conocimiento.`,
    '',
    '**Referencia reutilizable**'
  ];

  if (classification) lines.push(`- Categoría: ${classification}`);
  if (subject) lines.push(`- Caso: ${subject}`);
  if (description) lines.push(`- Síntoma o necesidad: ${description}`);
  if (resolution) lines.push(`- Resolución aplicada: ${resolution}`);

  lines.push(
    '',
    '**Opciones**',
    '- Buscar tickets similares por síntoma',
    '- Crear una solicitud con este contexto',
    '- Pedir una guía paso a paso basada en esta resolución'
  );

  return lines.join('\n');
}

function isResolvedKnowledgeStatus(status) {
  const normalized = normalizeComparableText(status);
  return /\b(cerrado|closed|resuelto|resolved)\b/.test(normalized);
}

function cleanKnowledgeText(text, maxLength) {
  const clean = redactSensitiveText(stripHtml(text || ''))
    .replace(/\b(?:solicitante|usuario|tecnico|técnico)\s*:\s*[^\n.;]+/gi, '')
    .replace(/\b(?:password|contraseña|clave)\s*[:=]\s*[^\s,.;]+/gi, '[credential-redacted]')
    .replace(/\b(?:servidor|server|host)\s*[:=]\s*[A-Za-z0-9._-]+/gi, '[host-redacted]')
    .replace(/\b(?:ip|direcci[oó]n ip)\s*[:=]\s*(?:\d{1,3}\.){3}\d{1,3}\b/gi, '[ip-redacted]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip-redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateText(clean, maxLength);
}

function redactKnowledgePeople(text, request) {
  let clean = String(text || '');
  const names = [
    getDisplayName(request?.requester),
    getDisplayName(request?.technician)
  ].filter(Boolean);

  for (const name of names) {
    const escapedName = escapeRegExp(name);
    if (escapedName) {
      clean = clean.replace(new RegExp(`\\b${escapedName}\\b`, 'gi'), '[persona-redacted]');
    }
  }

  return clean.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function isListedTicketFollowUpReviewRequest(message = '') {
  const normalized = normalizeComparableText(message);
  if (!normalized) return false;

  const mentionsFollowUps = /\b(seguimiento|seguimientos|nota|notas|comentario|comentarios|actualizacion|actualizaciones)\b/.test(normalized);
  const mentionsTickets = /\b(ticket|tickets|solicitud|solicitudes|listado|listados|anteriores|estos|esos|alguno|algun|hay|tienen|tenga)\b/.test(normalized);
  const asksReview = /\b(hay|tienen|tenga|revisa|revisar|muestra|mostrar|indica|indicame|dime|cuales|cuantos|verifica|verificar)\b/.test(normalized);

  return mentionsFollowUps && mentionsTickets && asksReview && !/\b(agrega|agregar|anade|anadir|poner|coloca|registrar|registra)\b/.test(normalized);
}

async function handleListedTicketFollowUpReview({
  message,
  user,
  session,
  onText,
  onCard,
  onWorking,
  responseChannel
}) {
  const ticketList = session?.operationalMemory?.lastTicketList?.tickets || [];
  if (ticketList.length === 0) {
    onText('Puedo hacerlo, pero primero necesito un listado reciente de tickets o que me indiques los IDs. Por ejemplo: “muéstrame mis tickets abiertos” y luego “¿cuáles tienen seguimientos?”');
    return;
  }

  await Promise.resolve(onWorking?.('Claro, reviso los tickets del último listado y separo cuáles tienen seguimientos visibles para ti.'));

  const wantsUserAddedNotesOnly = /\b(usuario|usuarios|solicitante|persona)\b/.test(normalizeComparableText(message));
  const ticketsToCheck = ticketList.slice(0, 10);
  const checked = [];
  const skipped = [];

  for (const ticket of ticketsToCheck) {
    try {
      const result = await callMcpTool('sdp_get_request_details', { request_id: ticket.id });
      await auditToolCall({ user, toolName: 'sdp_get_request_details', args: { request_id: ticket.id }, outcome: 'success' });
      const details = JSON.parse(result.content?.[0]?.text || '{}');
      const request = details?.request || details;

      if (!userCanReadRequest(user, request)) {
        skipped.push({ id: ticket.id, reason: 'sin permiso para ver el detalle' });
        continue;
      }

      const allNotes = getRequestNotes(request);
      const notes = wantsUserAddedNotesOnly ? allNotes.filter(isUserAddedNote) : allNotes;
      checked.push({
        request,
        notes,
        allNotesCount: allNotes.length,
        accessReason: getRequestAccessReason(user, request)
      });
    } catch (error) {
      await auditToolCall({ user, toolName: 'sdp_get_request_details', args: { request_id: ticket.id }, outcome: 'error', error });
      skipped.push({ id: ticket.id, reason: error.message || 'error consultando detalle' });
    }
  }

  const card = createListedTicketFollowUpReviewCard({
    checked,
    skipped,
    userAddedOnly: wantsUserAddedNotesOnly
  });

  if (responseChannel === 'teams' && card) {
    onCard?.(card);
    return;
  }

  onText(formatListedTicketFollowUpReviewText({
    checked,
    skipped,
    userAddedOnly: wantsUserAddedNotesOnly
  }));
}

function isUserAddedNote(note) {
  const author = normalizeComparableText(note?.author || '');
  if (!author) return true;
  return !/\b(sophia|chatbot|bot|system|sistema|servicedesk|service desk|sdp|administrator|admin)\b/.test(author);
}

function getRequestAccessReason(user, data) {
  if (isSupportAdmin(user)) return 'administrador';
  if (userCanAccessRequest(user, data)) return 'solicitante';
  if (userMatchesAssignedTechnician(user, data)) return 'técnico asignado';
  if (isMciRequestData(data) && userMatchesMciLeader(user, data)) return 'líder de MCI';
  return 'acceso autorizado';
}

function createListedTicketFollowUpReviewCard({ checked, skipped = [], userAddedOnly = false }) {
  const withNotes = checked.filter((entry) => entry.notes.length > 0);
  const withoutNotes = checked.filter((entry) => entry.notes.length === 0);
  const summaryText = withNotes.length > 0
    ? `Encontré ${withNotes.length} ticket${withNotes.length === 1 ? '' : 's'} con seguimiento${withNotes.length === 1 ? '' : 's'}${userAddedOnly ? ' agregado(s) por usuario' : ''}.`
    : `No encontré seguimientos${userAddedOnly ? ' agregados por usuario' : ''} en los tickets revisados.`;

  const body = [
    {
      type: 'TextBlock',
      text: 'Seguimientos en tickets listados',
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
    }
  ];

  if (withNotes.length > 0) {
    body.push(...withNotes.slice(0, 8).map((entry, index) => createFollowUpReviewItemBlock(entry, { shade: index % 2 === 1 })));
  } else {
    body.push({
      type: 'TextBlock',
      text: 'Puedes pedirme ver el detalle de un ticket específico o agregar un seguimiento al que necesite más contexto.',
      wrap: true,
      spacing: 'Medium'
    });
  }

  if (withoutNotes.length > 0) {
    body.push({
      type: 'TextBlock',
      text: `Sin seguimientos visibles: ${withoutNotes.slice(0, 8).map((entry) => `#${entry.request.id}`).join(', ')}`,
      wrap: true,
      spacing: 'Medium',
      isSubtle: true
    });
  }

  if (skipped.length > 0) {
    body.push({
      type: 'TextBlock',
      text: `No pude revisar: ${skipped.slice(0, 5).map((entry) => `#${entry.id} (${truncateText(entry.reason, 60)})`).join(', ')}`,
      wrap: true,
      spacing: 'Small',
      isSubtle: true
    });
  }

  body.push({
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
        text: [
          'Ver detalle del ticket #12345',
          'Agregar seguimiento al ticket #12345',
          'Listar tickets que requieren más atención'
        ].map((option) => `- ${option}`).join('\n'),
        wrap: true,
        spacing: 'Small',
        isSubtle: true
      }
    ]
  });

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

function createFollowUpReviewItemBlock(entry, options = {}) {
  const request = entry.request;
  const latestNote = entry.notes[0];
  const noteMeta = [latestNote.created, latestNote.author].filter(Boolean).join(' - ') || 'Seguimiento registrado';

  return {
    type: 'Container',
    style: options.shade ? 'accent' : 'default',
    spacing: 'Medium',
    separator: true,
    items: [
      {
        type: 'TextBlock',
        text: `#${request.id} - ${truncateText(request.subject || 'Sin asunto', 120)}`,
        weight: 'Bolder',
        color: 'Accent',
        wrap: true
      },
      {
        type: 'FactSet',
        spacing: 'Small',
        facts: [
          { title: 'Estado', value: getDisplayName(request.status) || '-' },
          { title: 'Prioridad', value: getDisplayName(request.priority) || '-' },
          { title: 'Acceso', value: entry.accessReason || '-' },
          { title: 'Seguimientos', value: String(entry.notes.length) }
        ]
      },
      {
        type: 'TextBlock',
        text: `${noteMeta}: ${truncateText(redactSensitiveText(latestNote.text), 260)}`,
        wrap: true,
        spacing: 'Small',
        isSubtle: true
      }
    ]
  };
}

function formatListedTicketFollowUpReviewText({ checked, skipped = [], userAddedOnly = false }) {
  const withNotes = checked.filter((entry) => entry.notes.length > 0);
  const lines = [
    withNotes.length > 0
      ? `Encontré ${withNotes.length} ticket(s) con seguimientos${userAddedOnly ? ' agregados por usuario' : ''}.`
      : `No encontré seguimientos${userAddedOnly ? ' agregados por usuario' : ''} en los tickets revisados.`
  ];

  for (const entry of withNotes.slice(0, 8)) {
    const latestNote = entry.notes[0];
    lines.push(`- #${entry.request.id}: ${truncateText(entry.request.subject || 'Sin asunto', 90)} | ${entry.accessReason} | ${entry.notes.length} seguimiento(s) | ${truncateText(redactSensitiveText(latestNote.text), 160)}`);
  }

  if (skipped.length > 0) {
    lines.push(`No pude revisar: ${skipped.map((entry) => `#${entry.id}`).join(', ')}.`);
  }

  return lines.join('\n');
}

async function enrichListToolOutputWithRecentFollowUps(toolOutput, user) {
  let data;
  try {
    data = JSON.parse(toolOutput);
  } catch {
    return toolOutput;
  }

  if (!Array.isArray(data?.requests) || data.requests.length === 0 || data?.result_type === 'mci') {
    return toolOutput;
  }

  const limit = Math.min(Number(process.env.SOPHIA_RECENT_FOLLOWUP_SCAN_LIMIT || 8), 10);
  const candidates = data.requests
    .filter((request) => request?.id && !isMciRequestData(request))
    .slice(0, limit);

  if (candidates.length === 0) return toolOutput;

  const followUpsById = new Map();

  for (const request of candidates) {
    try {
      const result = await callMcpTool('sdp_get_request_details', { request_id: request.id });
      const details = JSON.parse(result.content?.[0]?.text || '{}');
      const detailedRequest = details?.request || details;
      if (!userCanReadRequest(user, detailedRequest)) continue;

      const recentNotes = getRecentRequestNotes(detailedRequest);
      if (recentNotes.length === 0) continue;

      followUpsById.set(String(request.id), {
        count: recentNotes.length,
        latest: recentNotes[0],
        accessReason: getRequestAccessReason(user, detailedRequest)
      });
    } catch (error) {
      console.warn(`[Sophia] No se pudo revisar seguimientos recientes del ticket ${request.id}:`, error.message);
    }
  }

  if (followUpsById.size === 0) return toolOutput;

  const requests = data.requests.map((request) => {
    const followUp = followUpsById.get(String(request.id));
    if (!followUp) return request;
    return {
      ...request,
      sophia_recent_followups: followUp
    };
  });

  return JSON.stringify({
    ...data,
    list_info: {
      ...(data.list_info || {}),
      sophia_recent_followups_count: followUpsById.size,
      sophia_recent_followups_days: getRecentFollowUpDays()
    },
    requests
  }, null, 2);
}

function getRecentRequestNotes(request) {
  const thresholdMs = Date.now() - (getRecentFollowUpDays() * 24 * 60 * 60 * 1000);
  return getRequestNotes(request)
    .filter((note) => note.createdTimestamp && note.createdTimestamp >= thresholdMs)
    .sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0));
}

function getRecentFollowUpDays() {
  const days = Number(process.env.SOPHIA_RECENT_FOLLOWUP_DAYS || 7);
  return Number.isFinite(days) && days > 0 ? Math.min(days, 30) : 7;
}

async function runSupportTurn({
  message,
  user,
  session = null,
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

  if (isListedTicketFollowUpReviewRequest(message)) {
    await handleListedTicketFollowUpReview({
      message,
      user,
      session,
      onText,
      onCard,
      onWorking,
      responseChannel
    });
    return;
  }

  const clarification = getAdminPersonScopeClarification(message, user);
  if (clarification) {
    onText(clarification);
    return;
  }

  const ragContext = await getRagContextForMessage(message, user);
  const aiDecision = await AgentOrchestrator.processMessage(message, {
    user,
    ragContext,
    operationalMemory: sanitizeOperationalMemory(session?.operationalMemory)
  }, normalizeChatHistory(history));
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
    preparedArgs = await prepareToolArgs(aiDecision.tool_name, aiDecision.tool_args || {}, user, message, session);
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

    const diagnosticPrompt = getCreateRequestDiagnosticPrompt({
      toolName: aiDecision.tool_name,
      args: preparedArgs,
      message,
      history
    });
    if (diagnosticPrompt) {
      await auditToolCall({ user, toolName: aiDecision.tool_name, args: preparedArgs, outcome: 'diagnostic_requested' });
      onText(diagnosticPrompt);
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
      ...(responseChannel === 'teams' ? {
        args: preparedArgs,
        user,
        intro: aiDecision.content
      } : {}),
      expiresInMs: PENDING_ACTION_TTL_MS
    });
    return;
  }

  console.log(`[Bridge] Ejecutando: ${aiDecision.tool_name} con args:`, JSON.stringify(preparedArgs));
  onStatus?.(`Consultando herramienta: ${aiDecision.tool_name}...`);
  await Promise.resolve(onWorking?.(createWorkingMessage(aiDecision, message)));

  try {
    const toolResult = await callMcpTool(aiDecision.tool_name, preparedArgs);
    await auditToolCall({ user, toolName: aiDecision.tool_name, args: preparedArgs, outcome: 'success' });

    let toolOutput = toolResult.content[0].text;
    if (aiDecision.tool_name === 'sdp_list_requests') {
      toolOutput = await retryPersonSearchAccentInsensitive(toolOutput, preparedArgs, message);
    }
    if (aiDecision.tool_name === 'sdp_list_requests') {
      toolOutput = scopeListToolOutputForUser(toolOutput, user, message);
    }
    if (aiDecision.tool_name === 'sdp_list_requests' && isPersonalKeywordTicketSearchRequest(message)) {
      toolOutput = filterPersonalKeywordTicketsToolOutput(toolOutput, preparedArgs, message);
    }
    if (aiDecision.tool_name === 'sdp_list_requests' && isStaleTicketsRequest(message)) {
      toolOutput = filterStaleTicketsToolOutput(toolOutput, preparedArgs, message);
    }
    if (aiDecision.tool_name === 'sdp_list_requests') {
      toolOutput = await enrichListToolOutputWithRecentFollowUps(toolOutput, user);
    }
    if (aiDecision.tool_name === 'sdp_get_request_details') {
      const requestData = JSON.parse(toolOutput);
      if (!userCanReadRequest(user, requestData)) {
        const knowledgeResponse = createSanitizedKnowledgeResponse(requestData);
        if (knowledgeResponse) {
          onText(knowledgeResponse);
          return;
        }
        onText('Encontré ese ticket, pero no pertenece a tu usuario autenticado. Por seguridad no puedo mostrarlo. Si buscas una solución reutilizable, puedo ayudarte a buscar por síntoma, categoría o mensaje de error.');
        return;
      }
    }
    rememberLastTicketFromToolOutput(session, aiDecision.tool_name, toolOutput);

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

async function executeConfirmedAction(action, user, session = null) {
  const confirmedArgs = prepareConfirmedActionArgs(action);
  await assertToolAllowedForUser(action.toolName, confirmedArgs, user);
  const toolResult = await callMcpTool(action.toolName, confirmedArgs);
  const createdRequestId = action.toolName === 'sdp_create_request'
    ? extractRequestIdFromToolResult(toolResult)
    : null;
  const confirmedNoteVerification = action.toolName === 'sdp_add_note'
    ? getConfirmedNoteVerification(toolResult)
    : null;
  const auditArgs = createdRequestId
    ? { ...confirmedArgs, request_id: createdRequestId }
    : { ...confirmedArgs };
  if (confirmedNoteVerification) {
    auditArgs.sophia_note_verification = {
      checked: Boolean(confirmedNoteVerification.checked),
      found: Boolean(confirmedNoteVerification.found),
      count: confirmedNoteVerification.count || 0,
      source: confirmedNoteVerification.source || null,
      warning: confirmedNoteVerification.warning || null,
      error: confirmedNoteVerification.error || null
    };
  }
  await auditToolCall({
    user,
    toolName: action.toolName,
    args: auditArgs,
    outcome: 'confirmed_success'
  });
  rememberLastTicketFromToolOutput(session, action.toolName, toolResult.content?.[0]?.text);
  if (action.toolName !== 'sdp_update_mci' && confirmedArgs?.request_id) {
    rememberLastTicket(session, { id: confirmedArgs.request_id }, action.toolName);
  }

  if (action.toolName === 'sdp_update_mci' && confirmedArgs?.request_id) {
    const details = await callMcpTool('sdp_get_request_details', { request_id: confirmedArgs.request_id });
    const card = createTicketDetailsAdaptiveCard(details.content[0].text);
    if (card) {
      card.summaryText = `MCI #${confirmedArgs.request_id} actualizada`;
      return card;
    }
  }

  if (action.toolName === 'sdp_add_note' && confirmedArgs?.request_id) {
    const noteVerification = confirmedNoteVerification;
    if (noteVerification?.checked && !noteVerification.found) {
      return [
        `ServiceDesk Plus aceptó la operación para el ticket #${confirmedArgs.request_id}, pero no pude verificar que el seguimiento aparezca al consultar las notas.`,
        noteVerification.error ? `Detalle técnico: ${noteVerification.error}` : `Notas encontradas después de guardar: ${noteVerification.count || 0}. Fuente: ${noteVerification.source || 'no identificada'}.`,
        '',
        '**Opciones**',
        `- Ver detalle del ticket #${confirmedArgs.request_id}`,
        `- Intentar agregar el seguimiento nuevamente`,
        '- Revisar configuración de notas en SDP'
      ].join('\n');
    }

    return [
      `Listo, agregué el seguimiento al ticket #${confirmedArgs.request_id}.`,
      '',
      '**Opciones**',
      `- Ver detalle del ticket #${confirmedArgs.request_id}`,
      `- Agregar otro seguimiento al ticket #${confirmedArgs.request_id}`,
      '- Consultar mis tickets abiertos'
    ].join('\n');
  }

  return summarizeToolOutput(toolResult.content[0].text);
}

function getConfirmedNoteVerification(toolResult) {
  try {
    const data = JSON.parse(toolResult?.content?.[0]?.text || '{}');
    return data?.sophia_note_verification || null;
  } catch {
    return null;
  }
}

function prepareConfirmedActionArgs(action) {
  const args = { ...(action.args || {}) };
  if (args.udf_fields && typeof args.udf_fields === 'object') {
    args.udf_fields = { ...args.udf_fields };
  }

  if (action.toolName === 'sdp_create_request') {
    applyCreateTicketDefaults(args);
    normalizeCreateRequestUdfFields(args);
    sanitizeCreateRequestArgs(args);
    if (!args.udf_fields?.udf_pick_2701) {
      throw new Error('No pude completar el técnico asignado obligatorio (udf_pick_2701). Revisa SDP_DEFAULT_UDF_PICK_2701 o la ruta de clasificación antes de confirmar.');
    }
  }

  return args;
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
    'Responde en español con una voz humana, clara, atenta y orientadora. Debe sentirse como una persona competente explicando lo que encontró y ayudando a decidir el siguiente paso, no como una plantilla.',
    'Cuando haya un patrón útil, interpreta el resultado con criterio: qué conviene revisar primero, qué parece bloqueado, qué requiere seguimiento o qué puede esperar.',
    'Usa Markdown sobrio: tablas compactas cuando hay varios registros, y texto breve cuando el resultado se entiende mejor en prosa.',
    'No uses emojis, listas con alineación manual, columnas innecesarias ni frases rígidas como "según lo solicitado", "estimado usuario" o "procedo a".',
    'No digas que vas a consultar ni pidas esperar; ya tienes el resultado.',
    'No inventes datos ausentes, correos, teléfonos, técnicos ni IDs.',
    'Si un campo no existe, escribe "Sin asignar" solo para técnico; omite otros campos ausentes.',
    'Mantén la respuesta breve, pero completa. Si hay un patrón evidente, menciónalo en una frase: por ejemplo, estados repetidos, tickets sin técnico o asuntos similares.',
    'Evita sonar excesivamente ceremonial. Puedes usar frases naturales como "Encontré esto", "Lo más relevante es..." o "Veo que...".',
    'Después del resultado, agrega un bloque final **Opciones** con 2 o 3 acciones contextuales que el usuario puede pedir para continuar. Las opciones deben sonar como próximos pasos útiles, no como menú genérico.',
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
        'Si el resultado incluye notas o seguimientos, agrega una sección **Seguimientos** con las notas más recientes, sin exceder 5 entradas.',
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

  if (data?.result_type === 'stale_tickets') {
    return createStaleTicketsAdaptiveCard(data);
  }

  if (data?.result_type === 'personal_keyword_tickets') {
    return createPersonalKeywordTicketsAdaptiveCard(data);
  }

  const requests = Array.isArray(data?.requests) ? data.requests : [];
  const totalRows = Number(data?.list_info?.row_count || requests.length || 0);
  const isMciResult = data?.result_type === 'mci';
  const itemLabel = isMciResult ? 'MCI' : 'ticket';
  const visibleRequests = requests.slice(0, 8);
  const hasMoreRows = totalRows > 0 && (Boolean(data?.list_info?.has_more_rows) || requests.length > visibleRequests.length);
  const summaryText = `Encontré ${totalRows} ${itemLabel}${totalRows === 1 ? '' : 's'}.`;

  const headerRow = isMciResult
    ? null
    : createTicketTableRow(['Ticket', 'Asunto', 'Estado', 'Prioridad', 'Técnico'], { isHeader: true });
  const rows = isMciResult
    ? visibleRequests.map((request, index) => createMciListItemBlock(request, { shade: index % 2 === 1 }))
    : visibleRequests.map((request, index) => createTicketTableRow([
        `#${request.id || '-'}`,
        truncateText(request.subject || 'Sin asunto', 64),
        getDisplayName(request.status) || '-',
        getDisplayName(request.priority) || '-',
        getDisplayName(request.technician) || 'Sin asignar'
      ], { shade: index % 2 === 1 }));

  const body = isMciResult
    ? [
        createMciListHeaderBlock(summaryText),
        ...rows
      ]
    : [
        {
          type: 'TextBlock',
          text: 'Tickets encontrados',
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
        ...(headerRow ? [headerRow] : []),
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
  } else if (visibleRequests.length > 0) {
    const attentionBlock = createTicketAttentionBlock(visibleRequests);
    if (attentionBlock) body.push(attentionBlock);
    const recentFollowUpsBlock = createRecentFollowUpsHighlightBlock(visibleRequests);
    if (recentFollowUpsBlock) body.push(recentFollowUpsBlock);
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
    body.splice(isMciResult ? 1 : 2, 1, {
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

function filterPersonalKeywordTicketsToolOutput(toolOutput, preparedArgs = {}, message = '') {
  let data;
  try {
    data = JSON.parse(toolOutput);
  } catch {
    return toolOutput;
  }

  if (!Array.isArray(data?.requests)) return toolOutput;

  const keyword = String(preparedArgs.keyword || extractTicketKeywordFromMessage(message) || '').trim();
  const normalizedKeyword = normalizeComparableText(keyword);
  const limit = Math.min(Number(process.env.SOPHIA_KEYWORD_TICKET_SEARCH_RESULTS || 10), 10);
  const requests = data.requests
    .filter((request) => {
      if (!normalizedKeyword) return true;
      const haystack = normalizeComparableText([
        request.subject,
        getDisplayName(request.category),
        getDisplayName(request.subcategory),
        getDisplayName(request.status),
        getDisplayName(request.technician)
      ].filter(Boolean).join(' '));
      return haystack.includes(normalizedKeyword);
    })
    .sort((a, b) => (getRequestCreatedTimestamp(a) || 0) - (getRequestCreatedTimestamp(b) || 0))
    .slice(0, limit);

  return JSON.stringify({
    ...data,
    result_type: 'personal_keyword_tickets',
    sophia_keyword: keyword,
    list_info: {
      ...(data.list_info || {}),
      row_count: requests.length,
      has_more_rows: false,
      sophia_sorted_by: 'created_time_asc',
      sophia_limit: limit
    },
    requests
  }, null, 2);
}

function createPersonalKeywordTicketsAdaptiveCard(data) {
  const requests = Array.isArray(data?.requests) ? data.requests : [];
  const keyword = data?.sophia_keyword || 'criterio indicado';
  const summaryText = requests.length
    ? `Encontré ${requests.length} de tus tickets relacionados con "${keyword}", ordenados del más antiguo al más reciente.`
    : `No encontré tickets propios relacionados con "${keyword}".`;

  const body = [
    {
      type: 'TextBlock',
      text: 'Búsqueda en tus tickets',
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
    }
  ];

  if (requests.length > 0) {
    body.push(createTicketTableRow(['Ticket', 'Asunto', 'Estado', 'Creado'], { isHeader: true }));
    body.push(...requests.map((request, index) => createTicketTableRow([
      `#${request.id || '-'}`,
      truncateText(request.subject || 'Sin asunto', 70),
      getDisplayName(request.status) || '-',
      getDisplayDate(request.created_time) || '-'
    ], { shade: index % 2 === 1 })));
    const recentFollowUpsBlock = createRecentFollowUpsHighlightBlock(requests);
    if (recentFollowUpsBlock) body.push(recentFollowUpsBlock);
  } else {
    body.push({
      type: 'TextBlock',
      text: 'Puedes probar con una palabra más corta, parte del asunto, categoría o síntoma principal.',
      wrap: true,
      spacing: 'Medium'
    });
  }

  body.push({
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
        text: [
          'Ver detalle del ticket #12345',
          'Buscar otra palabra en mis tickets',
          'Filtrar mis tickets por estado'
        ].map((option) => `- ${option}`).join('\n'),
        wrap: true,
        spacing: 'Small',
        isSubtle: true
      }
    ]
  });

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

function createTicketAttentionBlock(requests) {
  const ranked = requests
    .map((request) => ({
      request,
      attention: scoreTicketAttention(request)
    }))
    .filter((entry) => entry.attention.score > 0)
    .sort((a, b) => b.attention.score - a.attention.score);

  if (ranked.length === 0) return null;

  const { request, attention } = ranked[0];
  const ticketId = `#${request.id || '-'}`;
  const reasons = attention.reasons.slice(0, 3).join('; ');
  const suggestion = attention.suggestion || 'Conviene revisar el detalle y decidir si requiere seguimiento.';

  return {
    type: 'Container',
    spacing: 'Medium',
    separator: true,
    style: 'emphasis',
    items: [
      {
        type: 'TextBlock',
        text: 'Requiere más atención',
        weight: 'Bolder',
        wrap: true
      },
      {
        type: 'TextBlock',
        text: `${ticketId} - ${truncateText(request.subject || 'Sin asunto', 120)}`,
        weight: 'Bolder',
        color: 'Attention',
        wrap: true,
        spacing: 'Small'
      },
      {
        type: 'TextBlock',
        text: `Motivo: ${reasons}.`,
        wrap: true,
        spacing: 'Small'
      },
      {
        type: 'TextBlock',
        text: `Siguiente paso sugerido: ${suggestion}`,
        wrap: true,
        isSubtle: true,
        spacing: 'Small'
      }
    ]
  };
}

function scoreTicketAttention(request) {
  const reasons = [];
  let score = 0;

  const priority = normalizeComparableText(getDisplayName(request.priority));
  const status = normalizeComparableText(getDisplayName(request.status));
  const technician = getDisplayName(request.technician) || getAssignedTechnicianValue(request);
  const dueTimestamp = getSdpTimestamp(request?.due_by_time);
  const updatedTimestamp = getRequestUpdatedTimestamp(request) || getRequestCreatedTimestamp(request);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  if (priority.includes('alta') || priority.includes('high') || priority.includes('urgente')) {
    score += 45;
    reasons.push('prioridad alta');
  } else if (priority.includes('media') || priority.includes('medium')) {
    score += 18;
    reasons.push('prioridad media');
  }

  if (status.includes('espera') || status.includes('hold')) {
    score += 30;
    reasons.push('está en espera');
  } else if (status.includes('suspend')) {
    score += 24;
    reasons.push('está suspendido');
  } else if (status.includes('proceso') || status.includes('progress')) {
    score += 16;
    reasons.push('está en proceso');
  } else if (status.includes('abiert') || status.includes('open')) {
    score += 12;
    reasons.push('sigue abierto');
  }

  if (dueTimestamp) {
    const daysToDue = Math.ceil((dueTimestamp - now) / dayMs);
    if (daysToDue < 0) {
      score += 40;
      reasons.push(`venció hace ${Math.abs(daysToDue)} día${Math.abs(daysToDue) === 1 ? '' : 's'}`);
    } else if (daysToDue <= 1) {
      score += 25;
      reasons.push('vence pronto');
    } else if (daysToDue <= 3) {
      score += 12;
      reasons.push('vence en pocos días');
    }
  }

  if (updatedTimestamp) {
    const staleDays = Math.floor((now - updatedTimestamp) / dayMs);
    if (staleDays >= 7) {
      score += 28;
      reasons.push(`sin actualización en ${staleDays} días`);
    } else if (staleDays >= 3) {
      score += 18;
      reasons.push(`sin actualización en ${staleDays} días`);
    }
  }

  if (!technician) {
    score += 14;
    reasons.push('no tiene técnico asignado');
  }

  return {
    score,
    reasons: reasons.length > 0 ? reasons : ['conviene revisar su estado'],
    suggestion: createTicketAttentionSuggestion({ priority, status, dueTimestamp, updatedTimestamp, technician })
  };
}

function createTicketAttentionSuggestion({ priority, status, dueTimestamp, updatedTimestamp, technician }) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const staleDays = updatedTimestamp ? Math.floor((now - updatedTimestamp) / dayMs) : 0;
  const overdue = dueTimestamp ? dueTimestamp < now : false;

  if (!technician) return 'validar asignación o agregar un seguimiento solicitando responsable.';
  if (overdue || priority.includes('alta') || priority.includes('high')) return 'abrir el detalle y agregar seguimiento para confirmar avance o escalamiento.';
  if (status.includes('espera') || status.includes('hold')) return 'revisar qué información falta y agregar un seguimiento concreto.';
  if (staleDays >= 3) return 'agregar seguimiento preguntando estado actual y próximo paso.';
  return 'abrir el detalle para confirmar si requiere seguimiento.';
}

function createRecentFollowUpsHighlightBlock(requests) {
  const entries = requests
    .filter((request) => request?.sophia_recent_followups?.latest?.text)
    .slice(0, 3);

  if (entries.length === 0) return null;

  const days = getRecentFollowUpDays();
  const lines = entries.map((request) => {
    const followUp = request.sophia_recent_followups;
    const latest = followUp.latest;
    const meta = [latest.created, latest.author].filter(Boolean).join(' - ');
    return `#${request.id}: ${truncateText(request.subject || 'Sin asunto', 70)}\n${meta ? `${meta}: ` : ''}${truncateText(redactSensitiveText(latest.text), 170)}`;
  });

  return {
    type: 'Container',
    spacing: 'Medium',
    separator: true,
    style: 'emphasis',
    items: [
      {
        type: 'TextBlock',
        text: `Seguimientos recientes (${days} días)`,
        weight: 'Bolder',
        color: 'Accent',
        wrap: true
      },
      {
        type: 'TextBlock',
        text: lines.map((line) => `- ${line}`).join('\n'),
        wrap: true,
        spacing: 'Small'
      },
      {
        type: 'TextBlock',
        text: 'Puedes pedirme el detalle de cualquiera de estos tickets o que agregue un seguimiento de respuesta.',
        wrap: true,
        spacing: 'Small',
        isSubtle: true
      }
    ]
  };
}

function filterStaleTicketsToolOutput(toolOutput, preparedArgs = {}, message = '') {
  let data;
  try {
    data = JSON.parse(toolOutput);
  } catch {
    return toolOutput;
  }

  if (!Array.isArray(data?.requests)) return toolOutput;

  const thresholdDays = Number(preparedArgs.stale_days || inferStaleDaysFromMessage(message) || process.env.SOPHIA_STALE_TICKET_DAYS || 3);
  const now = Date.now();
  const requests = data.requests
    .map((request) => {
      const updatedAt = getRequestUpdatedTimestamp(request) || getRequestCreatedTimestamp(request);
      const staleDays = updatedAt ? Math.max(0, Math.floor((now - updatedAt) / (24 * 60 * 60 * 1000))) : null;
      return {
        ...request,
        sophia_stale_days: staleDays,
        sophia_last_activity: getRequestLastActivityDisplay(request),
        sophia_followup_suggestion: createStaleTicketSuggestion(request, staleDays)
      };
    })
    .filter((request) => request.sophia_stale_days === null || request.sophia_stale_days >= thresholdDays)
    .sort((a, b) => (b.sophia_stale_days ?? -1) - (a.sophia_stale_days ?? -1));

  return JSON.stringify({
    ...data,
    result_type: 'stale_tickets',
    sophia_stale_threshold_days: thresholdDays,
    list_info: {
      ...(data.list_info || {}),
      row_count: requests.length,
      has_more_rows: false
    },
    requests
  }, null, 2);
}

function createStaleTicketsAdaptiveCard(data) {
  const requests = Array.isArray(data?.requests) ? data.requests : [];
  const thresholdDays = Number(data?.sophia_stale_threshold_days || 3);
  const visibleRequests = requests.slice(0, 8);
  const summaryText = requests.length
    ? `Encontré ${requests.length} ticket${requests.length === 1 ? '' : 's'} abierto${requests.length === 1 ? '' : 's'} con ${thresholdDays}+ días sin actualización.`
    : `No encontré tickets abiertos con ${thresholdDays}+ días sin actualización.`;

  const body = [
    {
      type: 'TextBlock',
      text: 'Tickets que necesitan seguimiento',
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
    }
  ];

  if (visibleRequests.length > 0) {
    body.push(...visibleRequests.map((request, index) => createStaleTicketItemBlock(request, { shade: index % 2 === 1 })));
    const recentFollowUpsBlock = createRecentFollowUpsHighlightBlock(visibleRequests);
    if (recentFollowUpsBlock) body.push(recentFollowUpsBlock);
  } else {
    body.push({
      type: 'TextBlock',
      text: 'No hay tickets que superen el umbral configurado. Puedes pedirme un rango mayor, por ejemplo: tickets sin avance en 1 día.',
      wrap: true,
      spacing: 'Medium'
    });
  }

  if (requests.length > visibleRequests.length) {
    body.push({
      type: 'TextBlock',
      text: `Mostré 8 de ${requests.length}. Puedes pedirme filtrar por técnico, prioridad o solicitante.`,
      isSubtle: true,
      wrap: true,
      spacing: 'Medium'
    });
  }

  body.push({
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
        text: [
          'Ver detalle del ticket #12345',
          'Agregar seguimiento al ticket #12345',
          'Filtrar por Técnico asignado o prioridad'
        ].map((option) => `- ${option}`).join('\n'),
        wrap: true,
        spacing: 'Small',
        isSubtle: true
      }
    ]
  });

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

function createStaleTicketItemBlock(request, options = {}) {
  const ticketId = `#${request.id || '-'}`;
  const staleDays = request.sophia_stale_days === null ? 'Sin fecha' : `${request.sophia_stale_days} día${request.sophia_stale_days === 1 ? '' : 's'}`;
  const suggestion = request.sophia_followup_suggestion || 'Agregar seguimiento solicitando actualización.';

  return {
    type: 'Container',
    style: options.shade ? 'accent' : 'default',
    spacing: 'Medium',
    separator: true,
    items: [
      {
        type: 'ColumnSet',
        columns: [
          {
            type: 'Column',
            width: 'auto',
            items: [
              {
                type: 'TextBlock',
                text: ticketId,
                weight: 'Bolder',
                color: 'Accent',
                wrap: false,
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
                text: truncateText(request.subject || 'Sin asunto', 120),
                weight: 'Bolder',
                wrap: true,
                size: 'Small'
              }
            ]
          },
          {
            type: 'Column',
            width: 'auto',
            verticalContentAlignment: 'Center',
            items: [
              {
                type: 'TextBlock',
                text: staleDays,
                weight: 'Bolder',
                color: getStaleDaysColor(request.sophia_stale_days),
                wrap: false,
                size: 'Small',
                horizontalAlignment: 'Right'
              }
            ]
          }
        ]
      },
      {
        type: 'FactSet',
        spacing: 'Small',
        facts: [
          { title: 'Estado', value: getDisplayName(request.status) || '-' },
          { title: 'Prioridad', value: getDisplayName(request.priority) || '-' },
          { title: 'Técnico', value: getDisplayName(request.technician) || getAssignedTechnicianValue(request) || 'Sin asignar' },
          { title: 'Última actualización', value: request.sophia_last_activity || '-' }
        ]
      },
      {
        type: 'TextBlock',
        text: `Sugerencia: ${suggestion}`,
        wrap: true,
        size: 'Small',
        isSubtle: true,
        spacing: 'Small'
      }
    ]
  };
}

function createStaleTicketSuggestion(request, staleDays) {
  const priority = normalizeComparableText(getDisplayName(request.priority));
  const technician = getDisplayName(request.technician) || getAssignedTechnicianValue(request);
  if (!technician) return 'Asignar técnico o agregar seguimiento solicitando asignación.';
  if (priority.includes('alta') || priority.includes('high') || Number(staleDays) >= 5) {
    return 'Agregar seguimiento pidiendo actualización y validar si requiere escalamiento.';
  }
  return 'Agregar seguimiento solicitando estado actual y próximo paso.';
}

function getStaleDaysColor(days) {
  if (days === null || days === undefined) return 'Warning';
  if (Number(days) >= 7) return 'Attention';
  if (Number(days) >= 3) return 'Warning';
  return 'Accent';
}

function getRequestUpdatedTimestamp(request) {
  return getSdpTimestamp(
    request?.last_updated_time ||
    request?.updated_time ||
    request?.last_update_time ||
    request?.modified_time ||
    request?.edit_time
  );
}

function getRequestCreatedTimestamp(request) {
  return getSdpTimestamp(request?.created_time);
}

function getRequestLastActivityDisplay(request) {
  return getDisplayDate(
    request?.last_updated_time ||
    request?.updated_time ||
    request?.last_update_time ||
    request?.modified_time ||
    request?.edit_time ||
    request?.created_time
  );
}

function getSdpTimestamp(value) {
  if (!value) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return Number(value);
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'object') {
    return getSdpTimestamp(value.value || value.display_value || value.name);
  }
  return null;
}

function scopeListToolOutputForUser(toolOutput, user, message = '') {
  if (isSupportAdmin(user) && !isPersonalTicketsRequest(message)) return toolOutput;

  let data;
  try {
    data = JSON.parse(toolOutput);
  } catch {
    return toolOutput;
  }

  if (!Array.isArray(data?.requests)) return toolOutput;

  const isMciResult = data?.result_type === 'mci' || isMciListRequest(message);
  const originalCount = data.requests.length;
  const scopedRequests = data.requests.filter((request) => userCanSeeListRequest(user, request, { isMciResult }));

  if (scopedRequests.length === originalCount) return toolOutput;

  console.warn(`[Security] Lista SDP filtrada por ownership: ${originalCount} -> ${scopedRequests.length} para ${user?.email || user?.name || 'usuario'}`);

  return JSON.stringify({
    ...data,
    list_info: {
      ...(data.list_info || {}),
      row_count: scopedRequests.length,
      has_more_rows: false,
      scoped_by_sophia: true
    },
    requests: scopedRequests
  }, null, 2);
}

async function retryPersonSearchAccentInsensitive(toolOutput, preparedArgs = {}, message = '') {
  const search = getAccentInsensitivePersonSearch(preparedArgs, message);
  if (!search) return toolOutput;

  let data;
  try {
    data = JSON.parse(toolOutput);
  } catch {
    return toolOutput;
  }

  const requests = Array.isArray(data?.requests) ? data.requests : [];
  const rowCount = Number(data?.list_info?.row_count ?? requests.length);
  if (requests.length > 0 || rowCount > 0) return toolOutput;

  const targetName = normalizeComparableText(search.value);
  if (!targetName) return toolOutput;

  const fallbackArgs = {
    ...preparedArgs,
    limit: Math.max(Number(preparedArgs.limit) || 0, 200)
  };
  delete fallbackArgs[search.argName];

  try {
    console.warn(`[SDP] Reintentando búsqueda sin sensibilidad a acentos para ${search.label}: ${search.value}`);
    const fallbackResult = await callMcpTool('sdp_list_requests', fallbackArgs);
    const fallbackText = fallbackResult.content?.[0]?.text;
    const fallbackData = JSON.parse(fallbackText);
    const fallbackRequests = Array.isArray(fallbackData?.requests) ? fallbackData.requests : [];
    const filteredRequests = fallbackRequests.filter((request) => {
      const candidateName = normalizeComparableText(search.getValue(request));
      return candidateName && (
        candidateName === targetName ||
        candidateName.includes(targetName) ||
        targetName.includes(candidateName)
      );
    });

    return JSON.stringify({
      ...fallbackData,
      result_type: isMciListRequest(message) ? 'mci' : fallbackData.result_type,
      list_info: {
        ...(fallbackData.list_info || {}),
        row_count: filteredRequests.length,
        has_more_rows: false,
        sophia_accent_insensitive: true,
        search_criteria: {
          condition: 'normalized_contains',
          field: search.field,
          value: search.value
        }
      },
      requests: filteredRequests
    }, null, 2);
  } catch (error) {
    console.warn(`[SDP] No se pudo aplicar respaldo sin acentos: ${error.message}`);
    return toolOutput;
  }
}

function getAccentInsensitivePersonSearch(preparedArgs = {}, message = '') {
  if (isMciListRequest(message) && preparedArgs.mci_leader_name) {
    return {
      argName: 'mci_leader_name',
      field: 'udf_fields.udf_pick_1503',
      label: 'Líder de MCI',
      value: preparedArgs.mci_leader_name,
      getValue: getMciLeaderValue
    };
  }

  if (preparedArgs.assigned_technician_name) {
    return {
      argName: 'assigned_technician_name',
      field: 'udf_fields.udf_pick_2701',
      label: 'Técnico asignado',
      value: preparedArgs.assigned_technician_name,
      getValue: getAssignedTechnicianValue
    };
  }

  return null;
}

function getAssignedTechnicianValue(request) {
  return getDisplayName(request?.udf_fields?.udf_pick_2701) || getDisplayName(request?.technician);
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
    request?.udf_fields?.udf_date_1508 ||
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
  if (isMciRequestData(request)) {
    return createMciDetailsAdaptiveCard(request);
  }

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
  const notes = getRequestNotes(request);
  const noteWarning = getNotesWarning(data, request);

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

  if (notes.length > 0) {
    body.push(createNotesDetailBlock(notes));
  } else if (noteWarning) {
    body.push(createDetailTextBlock('Seguimientos', noteWarning));
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

function createMciDetailsAdaptiveCard(request) {
  const mciId = `#${request.id}`;
  const subject = request.subject || 'Sin asunto';
  const summaryText = `Detalle de la MCI ${mciId}`;
  const rows = [
    ['Estado', getDisplayName(request.status) || '-'],
    ['Líder de MCI', getMciLeaderDisplayValue(request) || '-'],
    ['Avance', getMciProgressValue(request) || '-'],
    ['Predictiva', getMciPredictiveValue(request) || '-'],
    ['Actualización', getLastUpdatedValue(request) || '-'],
    ['Prioridad MCI', getDisplayName(request?.udf_fields?.udf_pick_1505) || '-'],
    ['MCI', getDisplayName(request?.udf_fields?.udf_pick_1501) || '-'],
    ['Num. MCI', getDisplayName(request?.udf_fields?.udf_pick_1504) || '-'],
    ['Etapa', getDisplayName(request?.udf_fields?.udf_pick_1510) || '-'],
    ['Etapa anterior', getDisplayName(request?.udf_fields?.udf_pick_1512) || '-'],
    ['Fecha inicio', getDisplayDate(request?.udf_fields?.udf_date_1509) || '-'],
    ['Fecha tope', getDisplayDate(request?.udf_fields?.udf_date_1802) || '-'],
    ['Técnico asignado', getDisplayName(request?.udf_fields?.udf_pick_2701) || getDisplayName(request.technician) || '-'],
    ['Solicitante', getDisplayName(request.requester) || '-']
  ];
  const description = stripHtml(request.description || request.short_description || '');

  const body = [
    {
      type: 'TextBlock',
      text: `MCI ${mciId}`,
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

  body.push(createMciDetailOptionsBlock(mciId));

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

function createMciDetailOptionsBlock(mciId) {
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
        text: [
          `Actualizar avance de la MCI ${mciId}`,
          `Actualizar predictiva de la MCI ${mciId}`,
          `Actualizar fecha de la MCI ${mciId}`
        ].map((option) => `- ${option}`).join('\n'),
        wrap: true,
        spacing: 'Small',
        isSubtle: true
      }
    ]
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

function getRequestNotes(request) {
  const notes = extractNotesFromRequestData(request);

  return notes
    .map((note) => {
      const createdValue = note?.created_time || note?.added_time || note?.created_at || note?.note?.created_time;
      return {
        text: stripHtml(getNoteText(note)),
        author: getDisplayName(note?.created_by || note?.added_by || note?.owner || note?.user || note?.note?.created_by),
        created: getDisplayDate(createdValue),
        createdTimestamp: getSdpTimestamp(createdValue)
      };
    })
    .filter((note) => note.text && note.text !== '[object Object]')
    .slice(0, 5);
}

function extractNotesFromRequestData(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  const directCandidates = [
    value.notes,
    value.request_notes,
    value.conversations,
    value.request_conversations,
    value.data,
    value.list
  ];

  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  if (typeof value === 'object') {
    for (const child of Object.values(value)) {
      const nested = extractNotesFromRequestData(child);
      if (nested.length > 0) return nested;
    }
  }

  return [];
}

function getNoteText(note) {
  if (!note) return '';
  if (typeof note === 'string') return note;
  return getNestedTextValue([
    note.description,
    note.content,
    note.text,
    note.notes,
    note.note_text,
    note.display_value,
    note.value,
    note.note?.description,
    note.note?.content,
    note.note?.text,
    note.note?.display_value,
    note.note?.value
  ]);
}

function getNestedTextValue(candidates) {
  for (const candidate of candidates) {
    const value = coerceTextValue(candidate);
    if (value) return value;
  }
  return '';
}

function coerceTextValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(coerceTextValue).filter(Boolean).join(' ');
  }
  if (typeof value === 'object') {
    return getNestedTextValue([
      value.content,
      value.description,
      value.text,
      value.value,
      value.display_value,
      value.name,
      value.html,
      value.plain_text,
      value.note_text
    ]);
  }
  return '';
}

function getNotesWarning(data, request) {
  const warnings = [
    ...(Array.isArray(data?.sophia_warnings) ? data.sophia_warnings : []),
    ...(Array.isArray(request?.sophia_warnings) ? request.sophia_warnings : [])
  ].filter(Boolean);

  const notesWarning = warnings.find((warning) => /nota|seguimiento/i.test(String(warning)));
  if (notesWarning) return String(notesWarning);
  if (request?.sophia_notes_checked) return 'No encontré seguimientos registrados para este ticket.';
  return '';
}

function createNotesDetailBlock(notes) {
  const text = notes
    .map((note) => {
      const meta = [note.created, note.author].filter(Boolean).join(' - ');
      return `${meta ? `${meta}: ` : ''}${truncateText(redactSensitiveText(note.text), 280)}`;
    })
    .map((line) => `- ${line}`)
    .join('\n');

  return {
    type: 'Container',
    spacing: 'Medium',
    separator: true,
    items: [
      {
        type: 'TextBlock',
        text: 'Seguimientos',
        weight: 'Bolder',
        wrap: true
      },
      {
        type: 'TextBlock',
        text,
        wrap: true,
        spacing: 'Small'
      }
    ]
  };
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

function createMciListHeaderBlock(summaryText) {
  return {
    type: 'Container',
    style: 'emphasis',
    bleed: true,
    spacing: 'None',
    items: [
      {
        type: 'ColumnSet',
        columns: [
          {
            type: 'Column',
            width: 'stretch',
            items: [
              {
                type: 'TextBlock',
                text: 'MCI encontradas',
                weight: 'Bolder',
                size: 'Medium',
                wrap: true
              },
              {
                type: 'TextBlock',
                text: summaryText,
                isSubtle: true,
                spacing: 'None',
                wrap: true
              }
            ]
          },
          {
            type: 'Column',
            width: 'auto',
            verticalContentAlignment: 'Center',
            items: [
              {
                type: 'TextBlock',
                text: 'MCI',
                color: 'Accent',
                weight: 'Bolder',
                size: 'Small',
                wrap: false
              }
            ]
          }
        ]
      }
    ]
  };
}

function createMciListItemBlock(request, options = {}) {
  const mciId = `#${request.id || '-'}`;
  const subject = truncateText(request.subject || 'Sin asunto', 140);
  const leader = getMciLeaderDisplayValue(request) || 'Sin asignar';
  const progress = getMciProgressValue(request) || '-';
  const updated = getLastUpdatedValue(request) || '-';
  const predictive = truncateText(getMciPredictiveValue(request) || '-', 160);

  return {
    type: 'Container',
    style: options.shade ? 'accent' : 'default',
    spacing: 'Medium',
    separator: true,
    items: [
      {
        type: 'ColumnSet',
        columns: [
          {
            type: 'Column',
            width: 'auto',
            items: [
              {
                type: 'TextBlock',
                text: mciId,
                weight: 'Bolder',
                color: 'Accent',
                wrap: false,
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
                text: subject,
                weight: 'Bolder',
                wrap: true,
                size: 'Small'
              }
            ]
          },
          {
            type: 'Column',
            width: 'auto',
            verticalContentAlignment: 'Center',
            items: [
              {
                type: 'TextBlock',
                text: progress,
                weight: 'Bolder',
                color: getMciProgressColor(progress),
                wrap: false,
                size: 'Medium',
                horizontalAlignment: 'Right'
              }
            ]
          }
        ]
      },
      {
        type: 'FactSet',
        spacing: 'Small',
        facts: [
          { title: 'Líder', value: leader },
          { title: 'Actualización', value: updated }
        ]
      },
      {
        type: 'TextBlock',
        text: `Predictiva: ${predictive}`,
        wrap: true,
        size: 'Small',
        isSubtle: true,
        spacing: 'Small'
      }
    ]
  };
}

function getMciProgressColor(progress) {
  const value = Number(String(progress || '').replace('%', '').trim());
  if (Number.isNaN(value)) return 'Default';
  if (value >= 90) return 'Good';
  if (value >= 50) return 'Accent';
  return 'Warning';
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
    scheduleRuntimeStateSave();
    return current;
  }

  const session = {
    user,
    history: [],
    operationalMemory: createEmptyOperationalMemory(),
    pendingActions: new Map(),
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  teamsSessions.set(key, session);
  scheduleRuntimeStateSave();
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
  if (activity?.value?.action && activity?.value?.actionId) {
    if (activity.value.action === 'sophia_confirm') return `__sophia_confirm:${activity.value.actionId}`;
    if (activity.value.action === 'sophia_cancel') return `__sophia_cancel:${activity.value.actionId}`;
  }

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
  const buttonActionMatch = normalizedText.match(/^__sophia_(confirm|cancel):([0-9a-f-]+)$/i);

  if (buttonActionMatch) {
    const [, buttonAction, actionId] = buttonActionMatch;
    const { action, expired } = takePendingAction(session, actionId);

    if (!action) {
      await sendTeamsReply(context, 'No tengo esa acción pendiente. Puede que ya se haya usado o que el backend se haya reiniciado.');
      return;
    }

    if (expired) {
      await auditToolCall({ user, toolName: action.toolName, args: action.args, outcome: 'confirmation_expired' });
      await sendTeamsReply(context, formatExpiredConfirmationMessage(action));
      return;
    }

    if (buttonAction === 'cancel') {
      await sendTeamsReply(context, 'Listo, cancelé esa acción pendiente.');
      return;
    }

    try {
      const summary = await executeConfirmedAction(action, user, session);
      session.history = pushChatHistory(session.history, 'assistant', summary?.summaryText || summary);
      scheduleRuntimeStateSave();
      await sendTeamsReply(context, summary);
    } catch (error) {
      await auditToolCall({ user, toolName: action.toolName, args: action.args, outcome: 'confirmed_error', error });
      console.error(`[Teams] Error confirmando acción ${action.toolName}:`, error.message);
      await sendTeamsReply(context, formatConfirmedActionError(action, error));
    }
    return;
  }

  if (CONFIRMATION_WORDS.has(normalizedText)) {
    const { action, expired } = takeFirstPendingAction(session);

    if (!action) {
      await sendTeamsReply(context, 'No tengo una acción pendiente para confirmar. Dime qué cambio quieres hacer y lo preparo de nuevo.');
      return;
    }

    if (expired) {
      await auditToolCall({ user, toolName: action.toolName, args: action.args, outcome: 'confirmation_expired' });
      await sendTeamsReply(context, formatExpiredConfirmationMessage(action));
      return;
    }

    try {
      const summary = await executeConfirmedAction(action, user, session);
      session.history = pushChatHistory(session.history, 'assistant', summary?.summaryText || summary);
      scheduleRuntimeStateSave();
      await sendTeamsReply(context, summary);
    } catch (error) {
      await auditToolCall({ user, toolName: action.toolName, args: action.args, outcome: 'confirmed_error', error });
      console.error(`[Teams] Error confirmando acción ${action.toolName}:`, error.message);
      await sendTeamsReply(context, formatConfirmedActionError(action, error));
    }
    return;
  }

  if (CANCEL_WORDS.has(normalizedText)) {
    session.pendingActions.clear();
    scheduleRuntimeStateSave();
    await sendTeamsReply(context, 'Listo, cancelé la acción pendiente.');
    return;
  }

  const chunks = [];
  await context.sendActivity({ type: 'typing' });
  await runSupportTurn({
    message: text,
    user,
    session,
    history: session.history,
    createPendingActionForUser: (action) => createPendingAction(session, action),
    onStatus: () => {},
    onText: (content) => chunks.push(content),
    onCard: (card) => chunks.push(card),
    onWorking: async (content) => {
      await context.sendActivity({ type: 'typing' });
      await sendTeamsReply(context, content);
    },
    onConfirmationRequired: (data) => {
      const summaryText = chunks.filter((chunk) => typeof chunk === 'string').join('').trim();
      chunks.length = 0;
      chunks.push(createTeamsConfirmationCard({ ...data, summaryText }));
    },
    streamSummary: false,
    responseChannel: 'teams'
  });

  const cardResponse = chunks.find((chunk) => chunk?.type === 'adaptive_card');
  if (cardResponse) {
    session.history = pushChatHistory(pushChatHistory(session.history, 'user', text), 'assistant', cardResponse.summaryText);
    scheduleRuntimeStateSave();
    await sendTeamsReply(context, cardResponse);
    return;
  }

  const response = truncateText(chunks.join('').trim(), 27000);
  session.history = pushChatHistory(pushChatHistory(session.history, 'user', text), 'assistant', response);
  scheduleRuntimeStateSave();
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
  scheduleRuntimeStateSave();
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
    applyTicketClassificationToArgs(createArgs, classification, description || subject || '');
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
    rememberLastTicketFromToolOutput(req.session, 'sdp_create_request', result.content?.[0]?.text);
    res.json(data);
  } catch (error) {
    console.error("Error creando ticket via MCP:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/confirm-action', requireAuth, async (req, res) => {
  const { actionId } = req.body;
  const { action, expired } = takePendingAction(req.session, actionId);

  if (!action) {
    return res.status(404).json({
      success: false,
      message: 'No tengo una acción pendiente para confirmar. Vuelve a preparar el cambio e inténtalo otra vez.'
    });
  }

  if (expired) {
    await auditToolCall({ user: req.user, toolName: action.toolName, args: action.args, outcome: 'confirmation_expired' });
    return res.status(410).json({
      success: false,
      message: formatExpiredConfirmationMessage(action)
    });
  }

  try {
    const summary = await executeConfirmedAction(action, req.user, req.session);
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
      session: auth.session,
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
  if (!req.get('authorization')) {
    return res.status(401).json({ success: false, message: 'Missing Bot Framework authorization header.' });
  }

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

async function startServer() {
  await loadRuntimeState();
  app.listen(PORT, () => {
    console.log(`Chatbot Backend Bridge corriendo en http://localhost:${PORT}`);
    initMCP();
  });
}

async function flushRuntimeStateAndExit(signal) {
  try {
    if (runtimeStateSaveTimer) {
      clearTimeout(runtimeStateSaveTimer);
      runtimeStateSaveTimer = null;
    }
    await saveRuntimeState();
    console.log(`[State] Estado runtime guardado antes de ${signal}.`);
  } catch (error) {
    console.warn(`[State] No se pudo guardar estado antes de ${signal}:`, error.message);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => flushRuntimeStateAndExit('SIGINT'));
process.on('SIGTERM', () => flushRuntimeStateAndExit('SIGTERM'));

startServer().catch((error) => {
  console.error('No se pudo iniciar el backend:', error);
  process.exit(1);
});
