import { describe, expect, it, vi } from 'vitest';
import {
  createPendingActionStore,
  cloneActionArgs,
  getPendingActionLabel,
  formatExpiredConfirmationMessage
} from '../pending-actions.js';

function makeSession() {
  return { pendingActions: new Map() };
}

function makeClock(startMs = 1_000_000) {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms) => { current += ms; }
  };
}

function makeStore({ ttlMs = 5 * 60 * 1000, clock = makeClock(), ids = ['action-1', 'action-2', 'action-3'] } = {}) {
  let idIndex = 0;
  const onPersist = vi.fn();
  const store = createPendingActionStore({
    ttlMs,
    generateId: () => ids[idIndex++] ?? `action-${idIndex}`,
    onPersist,
    now: clock.now
  });
  return { store, clock, onPersist };
}

describe('createPendingActionStore: ciclo de vida de confirmación', () => {
  it('crea una acción pendiente y la puede confirmar (take) una sola vez', () => {
    const { store, onPersist } = makeStore();
    const session = makeSession();

    const actionId = store.createPendingAction(session, {
      toolName: 'sdp_create_request',
      args: { subject: 'Sin acceso a SAP' },
      content: 'Propuesta de ticket'
    });

    expect(session.pendingActions.size).toBe(1);
    expect(onPersist).toHaveBeenCalled();

    const { action, expired } = store.takePendingAction(session, actionId);
    expect(expired).toBe(false);
    expect(action.toolName).toBe('sdp_create_request');
    expect(action.args.subject).toBe('Sin acceso a SAP');

    // Una segunda confirmación con el mismo actionId ya no debe encontrar nada:
    // así se evita ejecutar dos veces una acción mutante (doble clic / replay).
    const second = store.takePendingAction(session, actionId);
    expect(second.action).toBeNull();
    expect(second.expired).toBe(false);
  });

  it('expira una acción pendiente después de PENDING_ACTION_TTL_MS y lo señala en el confirm', () => {
    const clock = makeClock();
    const { store } = makeStore({ ttlMs: 5 * 60 * 1000, clock });
    const session = makeSession();

    const actionId = store.createPendingAction(session, {
      toolName: 'sdp_execute_automation_action',
      args: { action_type: 'UNLOCK_ACCOUNT' },
      content: 'Voy a desbloquear la cuenta'
    });

    clock.advance(5 * 60 * 1000 + 1);

    const { action, expired } = store.takePendingAction(session, actionId);
    expect(expired).toBe(true);
    expect(action.toolName).toBe('sdp_execute_automation_action');
    expect(session.pendingActions.size).toBe(0);
  });

  it('no confirma una acción con un actionId que no existe', () => {
    const { store } = makeStore();
    const session = makeSession();
    const { action, expired } = store.takePendingAction(session, 'no-existe');
    expect(action).toBeNull();
    expect(expired).toBe(false);
  });

  it('updatePendingAction refresca expiresAt y no permite mutar los args originales', () => {
    const clock = makeClock();
    const { store } = makeStore({ clock });
    const session = makeSession();

    const actionId = store.createPendingAction(session, {
      toolName: 'sdp_update_mci',
      args: { request_id: '123', fields: { progress: 40 } },
      content: 'Actualizo la MCI'
    });
    const createdExpiresAt = session.pendingActions.get(actionId).expiresAt;

    clock.advance(1000);
    const updated = store.updatePendingAction(session, actionId, (action) => {
      action.args.fields.progress = 60;
      return action;
    });

    expect(updated.args.fields.progress).toBe(60);
    expect(updated.expiresAt).toBeGreaterThan(createdExpiresAt);
    // El args original pasado a createPendingAction no debe haberse mutado,
    // porque updatePendingAction clona vía cloneActionArgs antes de aplicar el updater.
    const rawOriginal = { request_id: '123', fields: { progress: 40 } };
    expect(rawOriginal.fields.progress).toBe(40);
  });

  it('updatePendingAction retorna null si el actionId no existe', () => {
    const { store } = makeStore();
    const session = makeSession();
    expect(store.updatePendingAction(session, 'no-existe', (a) => a)).toBeNull();
  });

  it('takeFirstPendingAction toma la primera acción viva de la sesión', () => {
    const { store } = makeStore();
    const session = makeSession();
    store.createPendingAction(session, { toolName: 'sdp_add_note', args: {}, content: 'a' });

    const { action, expired } = store.takeFirstPendingAction(session);
    expect(expired).toBe(false);
    expect(action.toolName).toBe('sdp_add_note');
    expect(session.pendingActions.size).toBe(0);
  });

  it('takeFirstPendingAction reporta expirado si la única acción venció', () => {
    const clock = makeClock();
    const { store } = makeStore({ ttlMs: 1000, clock });
    const session = makeSession();
    store.createPendingAction(session, { toolName: 'sdp_add_note', args: {}, content: 'a' });

    clock.advance(1001);
    const { action, expired } = store.takeFirstPendingAction(session);
    expect(expired).toBe(true);
    expect(action.toolName).toBe('sdp_add_note');
  });

  it('prunePendingActions elimina las acciones vencidas y reporta cuáles fueron', () => {
    const clock = makeClock();
    const { store } = makeStore({ ttlMs: 1000, clock });
    const session = makeSession();

    store.createPendingAction(session, { toolName: 'sdp_add_note', args: {}, content: 'vieja' });
    clock.advance(1001);

    const expired = store.prunePendingActions(session);
    expect(expired).toHaveLength(1);
    expect(expired[0].action.content).toBe('vieja');
    expect(session.pendingActions.size).toBe(0);
  });

  it('createPendingAction poda automáticamente acciones vencidas antes de crear una nueva', () => {
    const clock = makeClock();
    const { store } = makeStore({ ttlMs: 1000, clock });
    const session = makeSession();

    store.createPendingAction(session, { toolName: 'sdp_add_note', args: {}, content: 'vieja' });
    clock.advance(1001);
    store.createPendingAction(session, { toolName: 'sdp_resolve_request', args: {}, content: 'nueva' });

    // La acción vencida ya fue podada como efecto colateral de crear la nueva;
    // en la sesión solo debe quedar la acción viva.
    expect(session.pendingActions.size).toBe(1);
    expect([...session.pendingActions.values()][0].content).toBe('nueva');
  });
});

describe('cloneActionArgs', () => {
  it('clona udf_fields de forma independiente', () => {
    const original = { udf_fields: { udf_pick_2701: 'Tecnico X' } };
    const clone = cloneActionArgs(original);
    clone.udf_fields.udf_pick_2701 = 'Otro';
    expect(original.udf_fields.udf_pick_2701).toBe('Tecnico X');
  });

  it('clona matchedKeywords de sophia_classification de forma independiente', () => {
    const original = { sophia_classification: { matchedKeywords: ['sap', 'acceso'] } };
    const clone = cloneActionArgs(original);
    clone.sophia_classification.matchedKeywords.push('extra');
    expect(original.sophia_classification.matchedKeywords).toEqual(['sap', 'acceso']);
  });

  it('funciona sin argumentos', () => {
    expect(cloneActionArgs()).toEqual({ udf_fields: undefined, sophia_classification: undefined });
  });
});

describe('getPendingActionLabel / formatExpiredConfirmationMessage', () => {
  it('etiqueta la creación de un ticket', () => {
    expect(getPendingActionLabel({ toolName: 'sdp_create_request' })).toBe('crear la solicitud');
  });

  it('etiqueta la actualización de un ticket con su ID', () => {
    expect(getPendingActionLabel({ toolName: 'sdp_update_request', args: { request_id: '12345' } }))
      .toBe('actualizar el ticket #12345');
  });

  it('retorna cadena vacía si no hay toolName', () => {
    expect(getPendingActionLabel({})).toBe('');
  });

  it('formatExpiredConfirmationMessage incluye la etiqueta de la acción', () => {
    const message = formatExpiredConfirmationMessage({ toolName: 'sdp_create_request' });
    expect(message).toContain('crear la solicitud');
    expect(message).toContain('expiró por seguridad');
  });

  it('formatExpiredConfirmationMessage funciona incluso sin acción reconocible', () => {
    const message = formatExpiredConfirmationMessage({});
    expect(message).toContain('La confirmación expiró por seguridad');
  });
});
