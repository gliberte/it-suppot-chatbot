// Máquina de estados de acciones pendientes de confirmación, usada por
// /api/confirm-action y por el flujo CONFIRMAR/CANCELAR de Teams. Se extrajo
// de server.js como fábrica con dependencias inyectadas (ttl, generador de id,
// reloj y callback de persistencia) para poder probarla sin levantar el bridge
// completo ni depender de su Map de sesiones en memoria.

export function cloneActionArgs(args = {}) {
  return {
    ...args,
    udf_fields: args.udf_fields && typeof args.udf_fields === 'object' ? { ...args.udf_fields } : args.udf_fields,
    sophia_classification: args.sophia_classification && typeof args.sophia_classification === 'object'
      ? {
          ...args.sophia_classification,
          matchedKeywords: Array.isArray(args.sophia_classification.matchedKeywords)
            ? [...args.sophia_classification.matchedKeywords]
            : args.sophia_classification.matchedKeywords
        }
      : args.sophia_classification
  };
}

export function getPendingActionLabel(action) {
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

export function formatExpiredConfirmationMessage(action) {
  const actionLabel = getPendingActionLabel(action);
  return [
    `La confirmación${actionLabel ? ` para ${actionLabel}` : ''} expiró por seguridad.`,
    'Vuelve a pedirme el cambio y lo preparo otra vez para que puedas confirmarlo.'
  ].join(' ');
}

export function createPendingActionStore({
  ttlMs,
  generateId,
  onPersist = () => {},
  now = () => Date.now()
}) {
  function prunePendingActions(session, persist = true) {
    const currentTime = now();
    const expiredActions = [];
    for (const [id, action] of session.pendingActions.entries()) {
      if (action.expiresAt <= currentTime) {
        session.pendingActions.delete(id);
        expiredActions.push({ id, action });
      }
    }
    if (expiredActions.length > 0 && persist) onPersist();
    return expiredActions;
  }

  function createPendingAction(session, { toolName, args, content }) {
    prunePendingActions(session);
    const actionId = generateId();
    session.pendingActions.set(actionId, {
      toolName,
      args,
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      editHistory: [],
      expiresAt: now() + ttlMs
    });
    onPersist();
    return actionId;
  }

  function updatePendingAction(session, actionId, updater) {
    prunePendingActions(session);
    const action = session.pendingActions.get(actionId);
    if (!action) return null;
    const updatedAction = updater({ ...action, args: cloneActionArgs(action.args) }) || action;
    updatedAction.updatedAt = new Date().toISOString();
    updatedAction.expiresAt = now() + ttlMs;
    session.pendingActions.set(actionId, updatedAction);
    onPersist();
    return updatedAction;
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
    onPersist();
    return { expired: false, action };
  }

  function takeFirstPendingAction(session) {
    const expiredActions = prunePendingActions(session);
    const pending = [...session.pendingActions.keys()][0];
    if (pending) return takePendingAction(session, pending);

    const latestExpired = expiredActions.at(-1)?.action || null;
    return { expired: Boolean(latestExpired), action: latestExpired };
  }

  return { prunePendingActions, createPendingAction, updatePendingAction, takePendingAction, takeFirstPendingAction };
}
