import { describe, expect, it } from 'vitest';
import {
  detectBirthdayIntent,
  isValidMonthDay,
  parseBirthdayFromMessage,
  formatMonthDay,
  createBirthdayRecord,
  isBirthdayToday,
  shouldSendBirthdayGreetingToday,
  createBirthdayGreetingText
} from '../birthdays.js';

describe('detectBirthdayIntent', () => {
  it('detecta intención de registrar', () => {
    expect(detectBirthdayIntent('mi cumpleaños es el 15 de marzo')).toBe('register');
    expect(detectBirthdayIntent('cumplo años el 20 de mayo')).toBe('register');
  });

  it('detecta intención de borrar', () => {
    expect(detectBirthdayIntent('borra mi cumpleaños')).toBe('delete');
    expect(detectBirthdayIntent('olvida mi cumpleaños por favor')).toBe('delete');
  });

  it('retorna null si el mensaje no menciona cumpleaños', () => {
    expect(detectBirthdayIntent('mis tickets abiertos')).toBeNull();
    expect(detectBirthdayIntent('')).toBeNull();
  });
});

describe('isValidMonthDay', () => {
  it('acepta fechas válidas', () => {
    expect(isValidMonthDay(3, 15)).toBe(true);
    expect(isValidMonthDay(2, 29)).toBe(true); // se permite 29 de febrero como fecha valida de cumpleaños
    expect(isValidMonthDay(12, 31)).toBe(true);
  });

  it('rechaza fechas inválidas', () => {
    expect(isValidMonthDay(13, 1)).toBe(false);
    expect(isValidMonthDay(0, 1)).toBe(false);
    expect(isValidMonthDay(4, 31)).toBe(false); // abril no tiene 31
    expect(isValidMonthDay(2, 30)).toBe(false);
  });

  it('rechaza valores no numéricos', () => {
    expect(isValidMonthDay(NaN, 1)).toBe(false);
    expect(isValidMonthDay(1, undefined)).toBe(false);
  });
});

describe('parseBirthdayFromMessage', () => {
  it('parsea "el 15 de marzo"', () => {
    expect(parseBirthdayFromMessage('mi cumpleaños es el 15 de marzo')).toEqual({ month: 3, day: 15 });
  });

  it('parsea nombres de mes sin acento y variantes (setiembre)', () => {
    expect(parseBirthdayFromMessage('cumplo años el 5 de setiembre')).toEqual({ month: 9, day: 5 });
    expect(parseBirthdayFromMessage('es el 5 de septiembre')).toEqual({ month: 9, day: 5 });
  });

  it('parsea formato numérico DD/MM', () => {
    expect(parseBirthdayFromMessage('mi cumple es 15/03')).toEqual({ month: 3, day: 15 });
  });

  it('parsea formato numérico DD-MM-AAAA ignorando el año', () => {
    expect(parseBirthdayFromMessage('nací el 15-03-1990')).toEqual({ month: 3, day: 15 });
  });

  it('retorna null si no hay fecha reconocible', () => {
    expect(parseBirthdayFromMessage('mi cumpleaños es pronto')).toBeNull();
  });

  it('retorna null para una fecha con mes o día inválido', () => {
    expect(parseBirthdayFromMessage('mi cumple es el 31 de abril')).toBeNull();
    expect(parseBirthdayFromMessage('mi cumple es 32/13')).toBeNull();
  });
});

describe('formatMonthDay', () => {
  it('formatea en español', () => {
    expect(formatMonthDay(3, 15)).toBe('15 de marzo');
    expect(formatMonthDay(12, 1)).toBe('1 de diciembre');
  });
});

describe('createBirthdayRecord', () => {
  it('normaliza el email a minúsculas y no incluye el año de nacimiento', () => {
    const record = createBirthdayRecord({
      sdpRequesterId: '5001',
      name: 'Ana Diaz',
      email: 'Ana.Diaz@Bacosa.com',
      month: 3,
      day: 15,
      now: new Date('2026-08-18T10:00:00.000Z')
    });
    expect(record.email).toBe('ana.diaz@bacosa.com');
    expect(record).not.toHaveProperty('year');
    expect(record.month).toBe(3);
    expect(record.day).toBe(15);
    expect(record.source).toBe('self_reported_chat');
    expect(record.consentedAt).toBe('2026-08-18T10:00:00.000Z');
    expect(record.lastCongratulatedYear).toBeNull();
  });
});

describe('isBirthdayToday / shouldSendBirthdayGreetingToday', () => {
  const record = { month: 3, day: 15, lastCongratulatedYear: null };

  it('es true solo si mes y día coinciden con hoy', () => {
    expect(isBirthdayToday(record, new Date('2026-03-15T12:00:00'))).toBe(true);
    expect(isBirthdayToday(record, new Date('2026-03-16T12:00:00'))).toBe(false);
    expect(isBirthdayToday(record, new Date('2026-04-15T12:00:00'))).toBe(false);
  });

  it('no envía dos veces el mismo año', () => {
    const alreadyGreeted = { month: 3, day: 15, lastCongratulatedYear: 2026 };
    expect(shouldSendBirthdayGreetingToday(alreadyGreeted, new Date('2026-03-15T12:00:00'))).toBe(false);
  });

  it('sí envía si es un año distinto al último saludo', () => {
    const greetedLastYear = { month: 3, day: 15, lastCongratulatedYear: 2025 };
    expect(shouldSendBirthdayGreetingToday(greetedLastYear, new Date('2026-03-15T12:00:00'))).toBe(true);
  });

  it('retorna false para un registro vacío/incompleto', () => {
    expect(isBirthdayToday(null)).toBe(false);
    expect(isBirthdayToday({})).toBe(false);
  });
});

describe('createBirthdayGreetingText', () => {
  it('usa solo el primer nombre', () => {
    expect(createBirthdayGreetingText('Ana Diaz')).toContain('¡Feliz cumpleaños, Ana!');
  });

  it('usa un saludo genérico si no hay nombre', () => {
    expect(createBirthdayGreetingText('')).toContain('colega');
  });
});
