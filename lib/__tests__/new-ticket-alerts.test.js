import { describe, expect, it } from 'vitest';
import { isNewTicketSinceWatermark, createNewTicketAlertMessage } from '../new-ticket-alerts.js';

describe('isNewTicketSinceWatermark', () => {
  it('no avisa en el primer sondeo (sin línea base todavía)', () => {
    expect(isNewTicketSinceWatermark(null, 2000)).toBe(false);
    expect(isNewTicketSinceWatermark(undefined, 2000)).toBe(false);
    expect(isNewTicketSinceWatermark(0, 2000)).toBe(false);
  });

  it('es true si el ticket se creó después de la línea base', () => {
    expect(isNewTicketSinceWatermark(1000, 2000)).toBe(true);
  });

  it('es false si el ticket es anterior o igual a la línea base', () => {
    expect(isNewTicketSinceWatermark(2000, 2000)).toBe(false);
    expect(isNewTicketSinceWatermark(2000, 1000)).toBe(false);
  });

  it('es false sin timestamp de creación', () => {
    expect(isNewTicketSinceWatermark(1000, null)).toBe(false);
  });
});

describe('createNewTicketAlertMessage', () => {
  it('incluye asunto, solicitante, categoría y prioridad', () => {
    const message = createNewTicketAlertMessage({
      requestId: '13900',
      subject: 'No puedo acceder a SAP',
      requesterName: 'Ana Diaz',
      category: 'Contraseñas',
      subcategory: 'SAP',
      priority: 'Alta'
    });
    expect(message).toContain('#13900');
    expect(message).toContain('No puedo acceder a SAP');
    expect(message).toContain('Ana Diaz');
    expect(message).toContain('Contraseñas / SAP');
    expect(message).toContain('Alta');
  });

  it('funciona con datos mínimos (solo requestId)', () => {
    const message = createNewTicketAlertMessage({ requestId: '13900' });
    expect(message).toContain('#13900');
  });
});
