// Sondeo periódico de tickets abiertos para avisarle al solicitante, en
// privado por Teams, cuando su ticket recibe un seguimiento (nota) nuevo o
// cambia de estado. No hay webhook de ServiceDesk Plus disponible (se
// verificó directamente en sdp-mcp-server: no existe ningún mecanismo de
// push), así que esto es sondeo, no empuje instantáneo. Funciones puras --
// la orquestación real (llamadas MCP, envío a Teams, persistencia) vive en
// server.js.

export function hasTicketChangedSinceLastPoll(storedState, currentLastUpdatedTime) {
  if (!currentLastUpdatedTime) return false;
  // Primera vez que vemos este ticket: solo se establece la línea base,
  // nunca se notifica por algo que pudo haber pasado antes de que Sophia
  // empezara a vigilarlo.
  if (!storedState || !storedState.lastUpdatedTime) return false;
  return currentLastUpdatedTime > storedState.lastUpdatedTime;
}

export function isNewNote(storedState, note) {
  if (!note || !note.createdTimestamp) return false;
  if (!storedState || !storedState.lastNoteTimestamp) return true;
  return note.createdTimestamp > storedState.lastNoteTimestamp;
}

export function createTicketFollowupMessage({ requestId, subject, status, note }) {
  const subjectPart = subject ? ` (${subject})` : '';

  if (note?.text) {
    const authorPart = note.author ? `**${note.author}**` : 'Alguien';
    return `🔔 Nuevo seguimiento en tu ticket #${requestId}${subjectPart}:\n\n${authorPart} escribió: "${note.text}"`;
  }

  const statusPart = status ? ` Estado actual: **${status}**.` : '';
  return `🔔 Tu ticket #${requestId}${subjectPart} fue actualizado.${statusPart}`;
}

export function createTicketFollowupTrackingState({ lastUpdatedTime, lastNoteTimestamp, requesterEmail }) {
  return {
    lastUpdatedTime: lastUpdatedTime || null,
    lastNoteTimestamp: lastNoteTimestamp || null,
    requesterEmail: (requesterEmail || '').toLowerCase()
  };
}
