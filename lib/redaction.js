// Minimización/redacción de datos antes de auditarlos o enviarlos a Gemini
// Cloud (ver sección "Minimización Para Gemini Cloud" del README). Todas las
// funciones son puras: solo transforman su argumento, sin I/O ni estado de
// módulo (sessions, mcpClient, etc.), para poder probarlas de forma aislada.

import { getDisplayName, normalizeComparableText } from './authz.js';

export function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}... [truncated]`;
}

export function stripHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ \n/g, '\n')
    .replace(/\n /g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function redactSensitiveText(text) {
  if (!text) return text;

  const ipMap = new Map();
  let ipCounter = 0;
  let cleanText = String(text).replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, (match) => {
    const key = `__IP_ADDR_${ipCounter++}__`;
    ipMap.set(key, match);
    return key;
  });

  cleanText = cleanText
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email-redacted]')
    .replace(/\b(?:\+?\d[\d\s()-]{7,}\d)\b/g, '[phone-redacted]')
    .replace(/\/api\/v3\/[^\s"')]+/g, '[internal-url-redacted]')
    .replace(/https?:\/\/[^\s"')]+/g, '[url-redacted]');

  for (const [key, ip] of ipMap.entries()) {
    cleanText = cleanText.replaceAll(key, ip);
  }

  return cleanText;
}

export function getEmailDomain(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return undefined;
  return email.split('@')[1].toLowerCase();
}

export function minimizePerson(person) {
  if (!person) return undefined;
  return {
    id: person.id,
    name: person.name,
    email_domain: getEmailDomain(person.email_id || person.email || person.mail),
    department: person.department?.name || person.department
  };
}

export function minimizeRequest(request) {
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
    description: truncateText(redactSensitiveText(stripHtml(request.description || request.short_description || '')), 2000),
    resolution: request.resolution?.content
      ? truncateText(redactSensitiveText(stripHtml(request.resolution.content)), 2000)
      : undefined
  };
}

export function minimizeValue(value) {
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
    if (['response_status', 'list_info', 'id', 'name', 'status', 'message', 'note', 'notes', 'status_code', 'result'].includes(key)) {
      allowed[key] = minimizeValue(childValue);
    }
  }
  return allowed;
}

export function minimizeToolOutputForGemini(toolOutput) {
  let parsed;
  try {
    parsed = JSON.parse(toolOutput);
  } catch {
    return truncateText(redactSensitiveText(toolOutput), 4000);
  }

  return JSON.stringify(minimizeValue(parsed), null, 2);
}

export function extractJsonFromErrorMessage(message) {
  const start = String(message || '').indexOf('{');
  const end = String(message || '').lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(message.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function minimizeAuditError(error) {
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

export function summarizeAuditUdfValue(value) {
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

export function summarizeAuditUdfFields(udfFields = {}) {
  return Object.fromEntries(
    Object.entries(udfFields).map(([key, value]) => [
      key,
      summarizeAuditUdfValue(value)
    ])
  );
}

export function minimizeAuditArgs(args = {}) {
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

export function createAuditTextPreview(text, maxLength = 500) {
  return truncateText(redactSensitiveText(stripHtml(String(text || ''))), maxLength);
}

export function getResolutionText(resolution) {
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

export function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isResolvedKnowledgeStatus(status) {
  const normalized = normalizeComparableText(status);
  return /\b(cerrado|closed|resuelto|resolved)\b/.test(normalized);
}

export function cleanKnowledgeText(text, maxLength) {
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

export function redactKnowledgePeople(text, request) {
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

export function createSanitizedKnowledgeResponse(data) {
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
