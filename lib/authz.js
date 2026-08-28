// Funciones puras de autenticación/autorización extraídas de server.js.
// No deben depender de estado del módulo (sessions, mcpClient, etc.) ni de I/O:
// solo de sus argumentos y de process.env. Esto permite probarlas de forma
// aislada sin levantar el bridge completo.

export function getBearerToken(req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : null;
}

export function normalizeComparableText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getDisplayName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.name || value.display_value || value.value || '';
}

export function getAssignedTechnicianValue(request) {
  return getDisplayName(request?.udf_fields?.udf_pick_2701) || getDisplayName(request?.technician);
}

export function getCsvEnvSet(name) {
  return new Set(
    (process.env[name] || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function getRequesterId(user) {
  return user?.sdpRequesterId || user?.id;
}

export function isSupportAdmin(user) {
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

export function getExecutiveItProfile(user) {
  if (!user) return null;

  const executiveEmails = getCsvEnvSet('SOPHIA_IT_EXECUTIVE_EMAILS');
  const executiveAadObjectIds = getCsvEnvSet('SOPHIA_IT_EXECUTIVE_AAD_OBJECT_IDS');
  const email = String(user.email || '').toLowerCase();
  const aadObjectId = String(user.aadObjectId || '').toLowerCase();
  const normalizedName = normalizeComparableText(user.name || user.displayName || '');
  const isYariela = normalizedName.includes('yariela saucedo') || normalizedName.includes('yariela saucedo de vallarino');

  if (
    isYariela ||
    (email && executiveEmails.has(email)) ||
    (aadObjectId && executiveAadObjectIds.has(aadObjectId))
  ) {
    return {
      type: 'it_executive',
      title: 'Gerente de IT',
      serviceStyle: 'executive_follow_up',
      reportingOptions: [
        'tickets nuevos generados por usuarios',
        'carga por personal técnico',
        'seguimientos recientes',
        'avances de MCI'
      ]
    };
  }

  return null;
}

export function isMciAdmin(user) {
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

export function isItExecutiveUser(user) {
  if (user?.executiveProfile?.type === 'it_executive' || getExecutiveItProfile(user)) return true;
  return isSupportAdmin(user) || isMciAdmin(user);
}

export function withUserRole(user) {
  if (!user) return user;
  const candidate = { ...user };
  candidate.executiveProfile = getExecutiveItProfile(candidate);
  candidate.role = (isSupportAdmin(candidate) || candidate.executiveProfile) ? 'support_admin' : (candidate.role || 'user');
  return candidate;
}

export function userCanAccessRequest(user, data) {
  const request = data?.request || data;
  const requester = request?.requester || {};
  const requesterId = String(requester.id || '');
  const requesterEmail = (requester.email_id || requester.email || '').toLowerCase();
  const userRequesterId = String(getRequesterId(user) || '');
  const userEmail = (user?.email || user?.mail || user?.userPrincipalName || '').toLowerCase();

  if (userRequesterId && requesterId && userRequesterId === requesterId) return true;
  if (userEmail && requesterEmail && userEmail === requesterEmail) return true;

  // Comparación por prefijo de correo (antes del @) si los dominios difieren
  if (userEmail && requesterEmail) {
    const userPrefix = userEmail.split('@')[0];
    const reqPrefix = requesterEmail.split('@')[0];
    if (userPrefix && reqPrefix && userPrefix.length > 2 && userPrefix === reqPrefix) return true;
  }

  // Comparación por nombre normalizado
  const requesterName = normalizeComparableText(requester.name || requester.display_value || '');
  const userName = normalizeComparableText(user?.name || user?.displayName || '');
  if (requesterName && userName) {
    if (requesterName === userName || requesterName.includes(userName) || userName.includes(requesterName)) {
      return true;
    }
  }

  return false;
}

export function userMatchesAssignedTechnician(user, data) {
  const request = data?.request || data;
  const techObj = request?.technician;
  const techEmail = (techObj?.email_id || techObj?.email || '').toLowerCase();
  const userEmail = (user?.email || user?.mail || user?.userPrincipalName || '').toLowerCase();

  if (userEmail && techEmail && userEmail === techEmail) return true;

  const techId = String(techObj?.id || '');
  const userTechId = String(getRequesterId(user) || '');
  if (techId && userTechId && techId === userTechId) return true;

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

export function isMciRequestData(data) {
  const request = data?.request || data;
  const udfFields = request?.udf_fields || {};
  const templateName = request?.template?.name || request?.request_template?.name || request?.template_name;
  const templateId = String(request?.template?.id || request?.request_template?.id || '');

  return templateName === 'PlantMCI' ||
    templateId === '604' ||
    Boolean(udfFields.udf_pick_1503 || udfFields.udf_pick_1501 || udfFields.udf_pick_1504);
}

export function getMciLeaderValue(data) {
  const request = data?.request || data;
  const leader = request?.udf_fields?.udf_pick_1503;
  if (!leader) return '';
  if (typeof leader === 'string') return leader;
  return leader.name || leader.display_value || leader.value || '';
}

export function userMatchesMciLeader(user, data) {
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

export function userCanReadRequest(user, data) {
  if (isSupportAdmin(user) || isItExecutiveUser(user) || isMciAdmin(user) || userCanAccessRequest(user, data) || userMatchesAssignedTechnician(user, data)) return true;
  return isMciRequestData(data) && userMatchesMciLeader(user, data);
}

export function userCanSeeListRequest(user, request, { isMciResult = false } = {}) {
  if (isMciResult) return userCanReadRequest(user, request);
  return isSupportAdmin(user) || isItExecutiveUser(user) || userCanAccessRequest(user, request) || userMatchesAssignedTechnician(user, request);
}

export function mciUpdateChangesLeader(args) {
  return Boolean(args?.fields?.leader || args?.fields?.leader_name || args?.fields?.mci_leader);
}

export function getDisallowedLeaderMciUpdateFields(args) {
  const leaderEditableFields = new Set(['current_date', 'description', 'predictive', 'progress']);
  return Object.keys(args?.fields || {}).filter((field) => !leaderEditableFields.has(field));
}

// Antes exigía "asignado(s) a ..." con preposición explícita (ej. "asignados a mí"), así que
// frases naturales de un técnico como "mis tickets asignados" o "tickets que tengo
// asignados" nunca activaban el alcance por técnico -- la consulta caía en requester_id
// (tickets que ÉL solicitó, no los que tiene asignados) y devolvía 0. Esto le pega sobre
// todo a técnicos fuera de los 5 técnicos nativos que permite la licencia gratuita de SDP:
// solo existen en el picklist personalizado udf_pick_2701, no como "technician" nativo.
// Basta con que aparezca la palabra "asignado/a/os/as" en cualquier forma; el emparejamiento
// contra el usuario actual (o el rechazo si nombra a alguien más) lo valida
// getSelfAssignedTechnicianScope en server.js, no esta función.
export function hasAssignedTechnicianScope(message) {
  return /\basignad[oa]s?\b/i.test(String(message || ''));
}
