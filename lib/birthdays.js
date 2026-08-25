// Registro de cumpleaños auto-reportados por chat y saludo privado de Sophia
// el día correspondiente. Solo mes y día (nunca el año, para no exponer la
// edad exacta) y solo por consentimiento explícito: la persona se lo dice a
// Sophia directamente. Funciones puras -- I/O y programación del cron viven
// en server.js.

const MONTH_NAMES_ES = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12
};

const MONTH_DISPLAY_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function detectBirthdayIntent(message) {
  const text = String(message || '').toLowerCase();
  if (!/cumplea[ñn]os|cumplo\s+a[ñn]os|mi\s+cumple\b/.test(text)) return null;
  if (/\b(borra|elimina|olvida|quita|borrar|eliminar|olvidar)\b/.test(text)) return 'delete';
  return 'register';
}

export function isValidMonthDay(month, day) {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return false;
  return true;
}

export function parseBirthdayFromMessage(message) {
  const text = String(message || '').toLowerCase();

  const monthNamePattern = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${Object.keys(MONTH_NAMES_ES).join('|')})\\b`);
  const monthNameMatch = text.match(monthNamePattern);
  if (monthNameMatch) {
    const day = Number(monthNameMatch[1]);
    const month = MONTH_NAMES_ES[monthNameMatch[2]];
    if (isValidMonthDay(month, day)) return { month, day };
  }

  const numericMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-]\d{2,4})?\b/);
  if (numericMatch) {
    const day = Number(numericMatch[1]);
    const month = Number(numericMatch[2]);
    if (isValidMonthDay(month, day)) return { month, day };
  }

  return null;
}

export function formatMonthDay(month, day) {
  return `${day} de ${MONTH_DISPLAY_ES[month - 1]}`;
}

export function createBirthdayRecord({ sdpRequesterId, name, email, month, day, source = 'self_reported_chat', now = new Date() }) {
  return {
    sdpRequesterId: String(sdpRequesterId),
    name: name || '',
    email: (email || '').toLowerCase(),
    month,
    day,
    consentedAt: now.toISOString(),
    source,
    lastCongratulatedYear: null
  };
}

export function isBirthdayToday(record, now = new Date()) {
  if (!record || !record.month || !record.day) return false;
  return record.month === now.getMonth() + 1 && record.day === now.getDate();
}

export function shouldSendBirthdayGreetingToday(record, now = new Date()) {
  if (!isBirthdayToday(record, now)) return false;
  return record.lastCongratulatedYear !== now.getFullYear();
}

export function createBirthdayGreetingText(name) {
  const firstName = String(name || '').trim().split(' ')[0] || 'colega';
  return `🎉 ¡Feliz cumpleaños, ${firstName}! Todo el equipo de Sophia y Soporte IT te desea un excelente día. 🎂`;
}
