// Aviso periódico al personal técnico IT (lista propia, IT_TECHNICAL_STAFF_EMAILS,
// distinta de SUPPORT_ADMIN_EMAILS) cada vez que se crea un ticket nuevo en
// ServiceDesk Plus. Mismo modelo de sondeo que lib/ticket-followups.js (no
// hay webhook disponible). Funciones puras -- la orquestación real vive en
// server.js.

export function isNewTicketSinceWatermark(previousWatermark, createdTimestamp) {
  if (!createdTimestamp) return false;
  // Primera vez que se sondea: solo se establece la línea base, nunca se
  // avisa de tickets que ya existían antes de que Sophia empezara a vigilar.
  if (!previousWatermark) return false;
  return createdTimestamp > previousWatermark;
}

export function createNewTicketAlertMessage({ requestId, subject, requesterName, category, subcategory, priority }) {
  const subjectPart = subject ? `: ${subject}` : '';
  const classification = [category, subcategory].filter(Boolean).join(' / ');

  const lines = [`🆕 Nuevo ticket #${requestId}${subjectPart}`];
  if (requesterName) lines.push(`Solicitante: ${requesterName}`);
  if (classification) lines.push(`Categoría: ${classification}`);
  if (priority) lines.push(`Prioridad: ${priority}`);

  return lines.join('\n');
}
