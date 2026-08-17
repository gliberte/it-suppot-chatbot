import { describe, expect, it } from 'vitest';
import {
  truncateText,
  stripHtml,
  redactSensitiveText,
  getEmailDomain,
  minimizePerson,
  minimizeRequest,
  minimizeValue,
  minimizeToolOutputForGemini,
  minimizeAuditError,
  extractJsonFromErrorMessage,
  minimizeAuditArgs,
  summarizeAuditUdfFields,
  summarizeAuditUdfValue,
  createAuditTextPreview,
  getResolutionText,
  escapeRegExp,
  isResolvedKnowledgeStatus,
  cleanKnowledgeText,
  redactKnowledgePeople,
  createSanitizedKnowledgeResponse,
  createAdaptiveCardPreview,
  createAdaptiveCardAuditSignals
} from '../redaction.js';

describe('truncateText', () => {
  it('deja el texto igual si no excede el máximo', () => {
    expect(truncateText('hola', 10)).toBe('hola');
  });

  it('trunca y agrega sufijo si excede el máximo', () => {
    expect(truncateText('a'.repeat(20), 5)).toBe('aaaaa... [truncated]');
  });

  it('retorna el valor original si es falsy', () => {
    expect(truncateText('', 10)).toBe('');
    expect(truncateText(null, 10)).toBeNull();
  });
});

describe('stripHtml', () => {
  it('convierte <br> y cierres de bloque en saltos de línea', () => {
    // Solo los cierres de bloque (</p>, </div>, etc.) y <br> insertan salto de
    // línea; las etiquetas de apertura como <p> se eliminan sin agregar nada.
    expect(stripHtml('<p>linea1</p><p>linea2<br>linea3</p>')).toBe('linea1\nlinea2\nlinea3');
  });

  it('elimina etiquetas restantes y &nbsp;', () => {
    expect(stripHtml('<b>hola</b>&nbsp;mundo')).toBe('hola mundo');
  });

  it('retorna cadena vacía para valores falsy', () => {
    expect(stripHtml('')).toBe('');
    expect(stripHtml(null)).toBe('');
  });
});

describe('redactSensitiveText', () => {
  it('redacta un correo', () => {
    expect(redactSensitiveText('contacta a luis.solano@bacosa.com')).toBe('contacta a [email-redacted]');
  });

  it('redacta un teléfono', () => {
    expect(redactSensitiveText('llamar al 6123-4567 hoy')).toContain('[phone-redacted]');
  });

  it('redacta rutas internas /api/v3/ y URLs genéricas', () => {
    expect(redactSensitiveText('ver /api/v3/requests/123')).toBe('ver [internal-url-redacted]');
    expect(redactSensitiveText('visita https://ejemplo.com/algo')).toBe('visita [url-redacted]');
  });

  it('preserva direcciones IP sin redactarlas', () => {
    expect(redactSensitiveText('servidor en 192.170.1.158:8080')).toBe('servidor en 192.170.1.158:8080');
  });

  it('retorna el valor original si es falsy', () => {
    expect(redactSensitiveText('')).toBe('');
    expect(redactSensitiveText(null)).toBeNull();
  });
});

describe('getEmailDomain', () => {
  it('extrae el dominio en minúsculas', () => {
    expect(getEmailDomain('Luis.Solano@BACOSA.com')).toBe('bacosa.com');
  });

  it('retorna undefined si no hay @ o el valor es inválido', () => {
    expect(getEmailDomain('no-es-correo')).toBeUndefined();
    expect(getEmailDomain(null)).toBeUndefined();
    expect(getEmailDomain(undefined)).toBeUndefined();
  });
});

describe('minimizePerson', () => {
  it('reduce una persona a id/nombre/dominio/departamento', () => {
    const person = {
      id: '7210',
      name: 'Luis Solano',
      email_id: 'luis.solano@bacosa.com',
      department: { name: 'IT' }
    };
    expect(minimizePerson(person)).toEqual({
      id: '7210',
      name: 'Luis Solano',
      email_domain: 'bacosa.com',
      department: 'IT'
    });
  });

  it('retorna undefined si la persona es falsy', () => {
    expect(minimizePerson(null)).toBeUndefined();
  });
});

describe('minimizeRequest', () => {
  it('redacta el asunto y limpia descripción/resolución de HTML', () => {
    const request = {
      id: '123',
      subject: 'Problema con luis.solano@bacosa.com',
      status: { name: 'Abierto' },
      description: '<p>No enciende</p>',
      resolution: { content: '<p>Se reinició el equipo</p>' },
      requester: { id: '1', name: 'Ana', email_id: 'ana@bacosa.com' }
    };
    const result = minimizeRequest(request);
    expect(result.id).toBe('123');
    expect(result.subject).toBe('Problema con [email-redacted]');
    expect(result.status).toBe('Abierto');
    expect(result.description).toBe('No enciende');
    expect(result.resolution).toBe('Se reinició el equipo');
    expect(result.requester).toEqual({ id: '1', name: 'Ana', email_domain: 'bacosa.com', department: undefined });
  });

  it('deja resolution undefined si no hay contenido', () => {
    const result = minimizeRequest({ id: '1' });
    expect(result.resolution).toBeUndefined();
  });
});

describe('minimizeValue', () => {
  it('envuelve request usando minimizeRequest', () => {
    const result = minimizeValue({ request: { id: '1', subject: 'x' } });
    expect(result).toHaveProperty('request');
    expect(result.request.id).toBe('1');
  });

  it('mapea requests[] con minimizeRequest y conserva response_status/list_info', () => {
    const result = minimizeValue({
      response_status: { status: 'ok' },
      list_info: { total: 2 },
      requests: [{ id: '1' }, { id: '2' }]
    });
    expect(result.requests).toHaveLength(2);
    expect(result.response_status).toEqual({ status: 'ok' });
  });

  it('mapea users[] con minimizePerson', () => {
    const result = minimizeValue({ users: [{ id: '1', name: 'A', email: 'a@bacosa.com' }] });
    expect(result.users[0]).toEqual({ id: '1', name: 'A', email_domain: 'bacosa.com', department: undefined });
  });

  it('limita arrays genéricos a 25 elementos', () => {
    const bigArray = Array.from({ length: 30 }, (_, i) => i);
    expect(minimizeValue(bigArray)).toHaveLength(25);
  });

  it('conserva solo las claves permitidas en objetos genéricos', () => {
    const result = minimizeValue({ id: '1', secret_field: 'no debe salir', name: 'Item' });
    expect(result).toEqual({ id: '1', name: 'Item' });
  });

  it('trunca y redacta strings largos', () => {
    const longEmail = `intro ${'a'.repeat(600)} correo@bacosa.com`;
    const result = minimizeValue(longEmail);
    expect(result.length).toBeLessThan(longEmail.length);
  });
});

describe('minimizeToolOutputForGemini', () => {
  it('minimiza un JSON válido y lo re-serializa', () => {
    const output = JSON.stringify({ request: { id: '1', subject: 'correo@bacosa.com' } });
    const result = JSON.parse(minimizeToolOutputForGemini(output));
    expect(result.request.id).toBe('1');
    expect(result.request.subject).toBe('[email-redacted]');
  });

  it('si no es JSON válido, trunca y redacta el texto plano', () => {
    const result = minimizeToolOutputForGemini('esto no es json correo@bacosa.com');
    expect(result).toBe('esto no es json [email-redacted]');
  });
});

describe('minimizeAuditError / extractJsonFromErrorMessage', () => {
  it('extrae campos y mensaje desde un error con JSON embebido de SDP', () => {
    const sdpError = {
      message: `Error creando solicitud: ${JSON.stringify({
        response_status: {
          status: 'failed',
          status_code: 4012,
          messages: [{ status_code: 4012, field: 'subcategory', message: 'Subcategory is mandatory' }]
        }
      })}`
    };
    const result = minimizeAuditError(sdpError);
    expect(result.fields).toEqual(['subcategory']);
    expect(result.message).toContain('Subcategory is mandatory');
  });

  it('retorna null si no hay error', () => {
    expect(minimizeAuditError(null)).toBeNull();
  });

  it('extractJsonFromErrorMessage retorna null si no hay JSON embebido', () => {
    expect(extractJsonFromErrorMessage('error simple sin json')).toBeNull();
  });

  it('minimizeAuditError funciona con un error simple sin JSON embebido', () => {
    const result = minimizeAuditError({ message: 'Timeout de conexión' });
    expect(result.message).toBe('Timeout de conexión');
    expect(result.fields).toEqual([]);
  });
});

describe('minimizeAuditArgs', () => {
  it('conserva solo las claves permitidas y agrega description_preview', () => {
    const result = minimizeAuditArgs({
      request_id: '123',
      subject: 'Falla de red',
      description: 'a'.repeat(300),
      internal_secret: 'no debe aparecer'
    });
    expect(result.request_id).toBe('123');
    expect(result.subject).toBe('Falla de red');
    expect(result.description_preview.length).toBeLessThan(300);
    expect(result).not.toHaveProperty('internal_secret');
    expect(result).not.toHaveProperty('description');
  });

  it('resume udf_fields con summarizeAuditUdfFields', () => {
    const result = minimizeAuditArgs({ udf_fields: { udf_pick_2701: { id: '1', name: 'Kassim Acevedo' } } });
    expect(result.udf_fields.udf_pick_2701).toEqual({
      id: '1',
      name: 'Kassim Acevedo',
      value: undefined,
      display_value: undefined
    });
  });

  it('deriva user_email_domain sin exponer el correo completo', () => {
    const result = minimizeAuditArgs({ user_email: 'ana.diaz@bacosa.com' });
    expect(result.user_email_domain).toBe('bacosa.com');
    expect(result).not.toHaveProperty('user_email');
  });
});

describe('summarizeAuditUdfFields / summarizeAuditUdfValue', () => {
  it('resume un valor objeto con id/name/value/display_value', () => {
    expect(summarizeAuditUdfValue({ id: '1', name: 'Ana' })).toEqual({
      id: '1',
      name: 'Ana',
      value: undefined,
      display_value: undefined
    });
  });

  it('resume un valor primitivo redactándolo', () => {
    expect(summarizeAuditUdfValue('correo@bacosa.com')).toBe('[email-redacted]');
  });

  it('summarizeAuditUdfFields aplica summarizeAuditUdfValue a cada entrada', () => {
    const result = summarizeAuditUdfFields({ udf_pick_2701: 'Kassim Acevedo' });
    expect(result.udf_pick_2701).toBe('Kassim Acevedo');
  });
});

describe('createAuditTextPreview', () => {
  it('limpia HTML, redacta y trunca en un solo paso', () => {
    const preview = createAuditTextPreview('<p>Contacto: correo@bacosa.com</p>', 100);
    expect(preview).toBe('Contacto: [email-redacted]');
  });

  it('respeta el maxLength por defecto', () => {
    const preview = createAuditTextPreview('a'.repeat(600));
    expect(preview.endsWith('[truncated]')).toBe(true);
  });
});

describe('getResolutionText', () => {
  it('retorna el string directo si la resolución ya es texto', () => {
    expect(getResolutionText('Se reinició el equipo')).toBe('Se reinició el equipo');
  });

  it('extrae content/description/text/display_value/name en ese orden', () => {
    expect(getResolutionText({ content: 'A', description: 'B' })).toBe('A');
    expect(getResolutionText({ description: 'B', text: 'C' })).toBe('B');
    expect(getResolutionText({ display_value: 'D' })).toBe('D');
  });

  it('retorna cadena vacía si no hay resolución', () => {
    expect(getResolutionText(null)).toBe('');
    expect(getResolutionText({})).toBe('');
  });
});

describe('escapeRegExp', () => {
  it('escapa caracteres especiales de regex', () => {
    expect(escapeRegExp('a.b*c?')).toBe('a\\.b\\*c\\?');
  });

  it('funciona con valores falsy', () => {
    expect(escapeRegExp(null)).toBe('');
  });
});

describe('isResolvedKnowledgeStatus', () => {
  it('reconoce estados cerrado/resuelto en español e inglés, con acentos', () => {
    expect(isResolvedKnowledgeStatus('Cerrado')).toBe(true);
    expect(isResolvedKnowledgeStatus('Resuelto')).toBe(true);
    expect(isResolvedKnowledgeStatus('Closed')).toBe(true);
    expect(isResolvedKnowledgeStatus('Resolved')).toBe(true);
  });

  it('no reconoce estados abiertos', () => {
    expect(isResolvedKnowledgeStatus('Abierto')).toBe(false);
    expect(isResolvedKnowledgeStatus('En Proceso')).toBe(false);
  });
});

describe('cleanKnowledgeText', () => {
  it('redacta contraseñas, hosts e IPs, y limpia HTML/whitespace', () => {
    const dirty = '<p>Password: micontraseña123 en servidor: srv-app-01 con ip: 192.170.1.10</p>';
    const clean = cleanKnowledgeText(dirty, 500);
    expect(clean).toContain('[credential-redacted]');
    expect(clean).toContain('[host-redacted]');
    expect(clean).toContain('[ip-redacted]');
    expect(clean).not.toContain('<p>');
  });

  it('elimina menciones de "solicitante:"/"usuario:"/"técnico:"', () => {
    const clean = cleanKnowledgeText('Solicitante: Ana Diaz reporta el problema', 500);
    expect(clean).not.toContain('Ana Diaz');
  });

  it('trunca al maxLength', () => {
    const clean = cleanKnowledgeText('a'.repeat(1000), 50);
    expect(clean.length).toBeLessThanOrEqual(50 + '... [truncated]'.length);
  });
});

describe('redactKnowledgePeople', () => {
  it('reemplaza el nombre del solicitante y del técnico por [persona-redacted]', () => {
    const request = { requester: { name: 'Ana Diaz' }, technician: { name: 'Kassim Acevedo' } };
    const text = redactKnowledgePeople('Ana Diaz reportó el problema, lo resolvió Kassim Acevedo', request);
    expect(text).toBe('[persona-redacted] reportó el problema, lo resolvió [persona-redacted]');
  });

  it('no falla si no hay requester/technician', () => {
    expect(redactKnowledgePeople('texto sin nombres', {})).toBe('texto sin nombres');
  });
});

describe('createSanitizedKnowledgeResponse', () => {
  const baseRequest = {
    id: '999',
    status: { name: 'Cerrado' },
    subject: 'Ana Diaz no puede imprimir',
    description: 'Ana Diaz reporta que la impresora no responde',
    resolution: { content: 'Se reinició el spooler de impresión, lo confirmó Kassim Acevedo' },
    category: { name: 'Impresoras' },
    requester: { name: 'Ana Diaz' },
    technician: { name: 'Kassim Acevedo' }
  };

  it('genera una referencia sanitizada para un ticket cerrado/resuelto', () => {
    const result = createSanitizedKnowledgeResponse({ request: baseRequest });
    expect(result).toContain('no pertenece a tu usuario');
    expect(result).toContain('Impresoras');
    expect(result).not.toContain('Ana Diaz');
    expect(result).not.toContain('Kassim Acevedo');
  });

  it('retorna null si el ticket no está en estado resuelto/cerrado', () => {
    const result = createSanitizedKnowledgeResponse({
      request: { ...baseRequest, status: { name: 'Abierto' } }
    });
    expect(result).toBeNull();
  });

  it('retorna null si no hay id de ticket', () => {
    expect(createSanitizedKnowledgeResponse({ request: { ...baseRequest, id: undefined } })).toBeNull();
  });

  it('retorna null si no hay ni descripción ni resolución utilizables', () => {
    const result = createSanitizedKnowledgeResponse({
      request: { ...baseRequest, description: '', resolution: null }
    });
    expect(result).toBeNull();
  });
});

describe('createAdaptiveCardPreview', () => {
  it('junta el texto de los TextBlock de una tarjeta adaptativa', () => {
    const card = {
      body: [
        { type: 'TextBlock', text: 'Confirmación requerida' },
        { type: 'Container', items: [{ type: 'TextBlock', text: 'Crear la solicitud' }] }
      ]
    };
    const preview = createAdaptiveCardPreview(card);
    expect(preview).toContain('Confirmación requerida');
    expect(preview).toContain('Crear la solicitud');
  });

  it('redacta datos sensibles dentro del texto de la tarjeta', () => {
    const card = { body: [{ type: 'TextBlock', text: 'Contacto: correo@bacosa.com' }] };
    expect(createAdaptiveCardPreview(card)).toBe('Contacto: [email-redacted]');
  });

  it('no falla con una tarjeta vacía', () => {
    expect(createAdaptiveCardPreview({})).toBe('');
  });
});

describe('createAdaptiveCardAuditSignals', () => {
  it('cuenta TextBlocks y detecta palabras clave', () => {
    const card = {
      body: [
        { type: 'TextBlock', text: 'Se agregó un seguimiento con el historial del ticket' },
        { type: 'TextBlock', text: 'Revisa tu correo para la nota adjunta' }
      ]
    };
    const signals = createAdaptiveCardAuditSignals(card);
    expect(signals.textBlockCount).toBe(2);
    expect(signals.hasSeguimientos).toBe(true);
    expect(signals.hasHistorial).toBe(true);
    expect(signals.hasCorreo).toBe(true);
    expect(signals.hasNota).toBe(true);
  });

  it('retorna señales en falso si no hay coincidencias', () => {
    const card = { body: [{ type: 'TextBlock', text: 'Ticket #123 actualizado' }] };
    const signals = createAdaptiveCardAuditSignals(card);
    expect(signals.hasSeguimientos).toBe(false);
    expect(signals.hasHistorial).toBe(false);
  });
});
