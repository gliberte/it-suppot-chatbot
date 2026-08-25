import { describe, expect, it } from 'vitest';
import {
  hasTicketChangedSinceLastPoll,
  isNewNote,
  createTicketFollowupMessage,
  createTicketFollowupTrackingState
} from '../ticket-followups.js';

describe('hasTicketChangedSinceLastPoll', () => {
  it('no notifica la primera vez que se ve un ticket (solo establece línea base)', () => {
    expect(hasTicketChangedSinceLastPoll(null, 1000)).toBe(false);
    expect(hasTicketChangedSinceLastPoll({}, 1000)).toBe(false);
  });

  it('es true si el timestamp actual es mayor al último visto', () => {
    expect(hasTicketChangedSinceLastPoll({ lastUpdatedTime: 1000 }, 2000)).toBe(true);
  });

  it('es false si no hay cambio real', () => {
    expect(hasTicketChangedSinceLastPoll({ lastUpdatedTime: 2000 }, 2000)).toBe(false);
    expect(hasTicketChangedSinceLastPoll({ lastUpdatedTime: 3000 }, 2000)).toBe(false);
  });

  it('es false si no hay timestamp actual', () => {
    expect(hasTicketChangedSinceLastPoll({ lastUpdatedTime: 1000 }, null)).toBe(false);
  });
});

describe('isNewNote', () => {
  it('es false si no hay nota', () => {
    expect(isNewNote({ lastNoteTimestamp: 1000 }, null)).toBe(false);
  });

  it('es true la primera vez que se detecta una nota (sin estado previo)', () => {
    expect(isNewNote(null, { text: 'hola', createdTimestamp: 500 })).toBe(true);
    expect(isNewNote({}, { text: 'hola', createdTimestamp: 500 })).toBe(true);
  });

  it('es true solo si la nota es más nueva que la última vista', () => {
    expect(isNewNote({ lastNoteTimestamp: 1000 }, { text: 'x', createdTimestamp: 2000 })).toBe(true);
    expect(isNewNote({ lastNoteTimestamp: 2000 }, { text: 'x', createdTimestamp: 1000 })).toBe(false);
    expect(isNewNote({ lastNoteTimestamp: 2000 }, { text: 'x', createdTimestamp: 2000 })).toBe(false);
  });
});

describe('createTicketFollowupMessage', () => {
  it('usa el texto y autor de la nota cuando hay una nota nueva', () => {
    const message = createTicketFollowupMessage({
      requestId: '12345',
      subject: 'No puedo acceder a SAP',
      status: 'En Proceso',
      note: { text: 'Ya revisamos tu caso, seguimos trabajando en ello.', author: 'Kassim Acevedo' }
    });
    expect(message).toContain('#12345');
    expect(message).toContain('No puedo acceder a SAP');
    expect(message).toContain('Kassim Acevedo');
    expect(message).toContain('Ya revisamos tu caso');
  });

  it('cae a un mensaje genérico con el estado si no hay nota nueva', () => {
    const message = createTicketFollowupMessage({
      requestId: '12345',
      subject: 'No puedo acceder a SAP',
      status: 'Resuelto',
      note: null
    });
    expect(message).toContain('#12345');
    expect(message).toContain('fue actualizado');
    expect(message).toContain('Resuelto');
  });

  it('funciona sin asunto ni estado', () => {
    const message = createTicketFollowupMessage({ requestId: '999', note: null });
    expect(message).toContain('#999');
  });
});

describe('createTicketFollowupTrackingState', () => {
  it('normaliza el email a minúsculas', () => {
    const state = createTicketFollowupTrackingState({
      lastUpdatedTime: 1000,
      lastNoteTimestamp: 500,
      requesterEmail: 'Ana.Diaz@Bacosa.com'
    });
    expect(state.requesterEmail).toBe('ana.diaz@bacosa.com');
    expect(state.lastUpdatedTime).toBe(1000);
    expect(state.lastNoteTimestamp).toBe(500);
  });

  it('usa null como valor por defecto', () => {
    const state = createTicketFollowupTrackingState({});
    expect(state.lastUpdatedTime).toBeNull();
    expect(state.lastNoteTimestamp).toBeNull();
    expect(state.requesterEmail).toBe('');
  });
});
