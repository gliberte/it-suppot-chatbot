import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getBearerToken,
  isSupportAdmin,
  isMciAdmin,
  isItExecutiveUser,
  getExecutiveItProfile,
  userCanAccessRequest,
  userMatchesAssignedTechnician,
  userCanReadRequest,
  userCanSeeListRequest,
  isMciRequestData,
  userMatchesMciLeader,
  getDisallowedLeaderMciUpdateFields,
  mciUpdateChangesLeader
} from '../authz.js';

const ENV_KEYS = [
  'TEAMS_ADMIN_AAD_OBJECT_IDS',
  'SUPPORT_ADMIN_EMAILS',
  'SUPPORT_ADMIN_SDP_REQUESTER_IDS',
  'MCI_ADMIN_AAD_OBJECT_IDS',
  'MCI_ADMIN_EMAILS',
  'MCI_ADMIN_SDP_REQUESTER_IDS',
  'SOPHIA_IT_EXECUTIVE_EMAILS',
  'SOPHIA_IT_EXECUTIVE_AAD_OBJECT_IDS'
];

let envBackup;

beforeEach(() => {
  envBackup = {};
  for (const key of ENV_KEYS) {
    envBackup[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (envBackup[key] === undefined) delete process.env[key];
    else process.env[key] = envBackup[key];
  }
});

describe('getBearerToken', () => {
  const req = (header) => ({ get: () => header });

  it('extrae el token de un header Bearer válido', () => {
    expect(getBearerToken(req('Bearer abc123'))).toBe('abc123');
  });

  it('es insensible a mayúsculas en el esquema', () => {
    expect(getBearerToken(req('bearer abc123'))).toBe('abc123');
  });

  it('retorna null si no hay header', () => {
    expect(getBearerToken(req(''))).toBeNull();
  });

  it('retorna null si el esquema no es Bearer', () => {
    expect(getBearerToken(req('Basic abc123'))).toBeNull();
  });
});

describe('isSupportAdmin', () => {
  it('es false para un usuario sin flags ni configuración', () => {
    expect(isSupportAdmin({ email: 'user@bacosa.com' })).toBe(false);
  });

  it('es true si el usuario trae isSupportAdmin', () => {
    expect(isSupportAdmin({ isSupportAdmin: true })).toBe(true);
  });

  it('es true si el usuario trae role admin o support_admin', () => {
    expect(isSupportAdmin({ role: 'admin' })).toBe(true);
    expect(isSupportAdmin({ role: 'support_admin' })).toBe(true);
  });

  it('es true si el email está en SUPPORT_ADMIN_EMAILS (case-insensitive)', () => {
    process.env.SUPPORT_ADMIN_EMAILS = 'luis.solano@bacosa.com, otra@bacosa.com';
    expect(isSupportAdmin({ email: 'Luis.Solano@Bacosa.com' })).toBe(true);
    expect(isSupportAdmin({ email: 'nadie@bacosa.com' })).toBe(false);
  });

  it('es true si el aadObjectId está en TEAMS_ADMIN_AAD_OBJECT_IDS', () => {
    process.env.TEAMS_ADMIN_AAD_OBJECT_IDS = 'aad-1,aad-2';
    expect(isSupportAdmin({ aadObjectId: 'aad-2' })).toBe(true);
  });

  it('es true si el sdpRequesterId está en SUPPORT_ADMIN_SDP_REQUESTER_IDS', () => {
    process.env.SUPPORT_ADMIN_SDP_REQUESTER_IDS = '7210';
    expect(isSupportAdmin({ sdpRequesterId: '7210' })).toBe(true);
    expect(isSupportAdmin({ id: '7210' })).toBe(true);
  });

  it('es false para un usuario nulo/indefinido', () => {
    expect(isSupportAdmin(null)).toBe(false);
    expect(isSupportAdmin(undefined)).toBe(false);
  });
});

describe('isMciAdmin', () => {
  it('es true si coincide con MCI_ADMIN_EMAILS', () => {
    process.env.MCI_ADMIN_EMAILS = 'lider@bacosa.com';
    expect(isMciAdmin({ email: 'lider@bacosa.com' })).toBe(true);
  });

  it('cae a isSupportAdmin cuando no hay listas MCI configuradas', () => {
    process.env.SUPPORT_ADMIN_EMAILS = 'admin@bacosa.com';
    expect(isMciAdmin({ email: 'admin@bacosa.com' })).toBe(true);
    expect(isMciAdmin({ email: 'otro@bacosa.com' })).toBe(false);
  });

  it('no cae a isSupportAdmin si ya hay listas MCI configuradas (aunque no matcheen)', () => {
    process.env.MCI_ADMIN_EMAILS = 'lider@bacosa.com';
    process.env.SUPPORT_ADMIN_EMAILS = 'admin@bacosa.com';
    expect(isMciAdmin({ email: 'admin@bacosa.com' })).toBe(false);
  });
});

describe('getExecutiveItProfile / isItExecutiveUser', () => {
  it('reconoce a Yariela Saucedo por nombre aunque no esté en la lista de env', () => {
    const profile = getExecutiveItProfile({ name: 'Yariela Saucedo de Vallarino' });
    expect(profile?.type).toBe('it_executive');
  });

  it('retorna null para un usuario normal sin listas configuradas', () => {
    expect(getExecutiveItProfile({ name: 'Juan Perez', email: 'juan@bacosa.com' })).toBeNull();
  });

  it('isItExecutiveUser es false por defecto para un usuario normal sin listas configuradas', () => {
    // Antes de este fix, sin SOPHIA_IT_EXECUTIVE_* configurado, la función
    // trataba a CUALQUIER usuario como ejecutivo, lo que dejaba pasar el
    // reporte ejecutivo y saltaba el chequeo de ownership en acciones
    // mutantes (ver server.js: handleExecutiveItTurn y el guard de
    // assertToolAllowedForUser). Debe ser restrictivo por defecto.
    expect(isItExecutiveUser({ name: 'Cualquier Usuario' })).toBe(false);
  });

  it('isItExecutiveUser respeta las listas cuando están configuradas', () => {
    process.env.SOPHIA_IT_EXECUTIVE_EMAILS = 'gerente@bacosa.com';
    expect(isItExecutiveUser({ email: 'gerente@bacosa.com' })).toBe(true);
    expect(isItExecutiveUser({ email: 'otro@bacosa.com' })).toBe(false);
  });

  it('isItExecutiveUser es true para support admins y MCI admins aunque no estén en la lista ejecutiva', () => {
    expect(isItExecutiveUser({ role: 'support_admin' })).toBe(true);
    process.env.MCI_ADMIN_EMAILS = 'lider@bacosa.com';
    expect(isItExecutiveUser({ email: 'lider@bacosa.com' })).toBe(true);
  });
});

describe('userCanAccessRequest (ownership de tickets)', () => {
  it('coincide por sdpRequesterId', () => {
    const user = { sdpRequesterId: '7210' };
    const data = { request: { requester: { id: '7210' } } };
    expect(userCanAccessRequest(user, data)).toBe(true);
  });

  it('coincide por email exacto', () => {
    const user = { email: 'user@bacosa.com' };
    const data = { request: { requester: { email_id: 'user@bacosa.com' } } };
    expect(userCanAccessRequest(user, data)).toBe(true);
  });

  it('coincide por prefijo de correo entre dominios distintos', () => {
    const user = { email: 'luis.solano@bacosa.com' };
    const data = { request: { requester: { email_id: 'luis.solano@barraza.local' } } };
    expect(userCanAccessRequest(user, data)).toBe(true);
  });

  it('no coincide por prefijo si es demasiado corto (protección anti falso-positivo)', () => {
    const user = { email: 'ab@bacosa.com' };
    const data = { request: { requester: { email_id: 'ab@barraza.local' } } };
    expect(userCanAccessRequest(user, data)).toBe(false);
  });

  it('coincide por nombre normalizado (ignorando acentos)', () => {
    const user = { name: 'José Pérez' };
    const data = { request: { requester: { name: 'jose perez' } } };
    expect(userCanAccessRequest(user, data)).toBe(true);
  });

  it('no coincide si no hay ninguna señal en común', () => {
    const user = { sdpRequesterId: '1', email: 'a@bacosa.com', name: 'A' };
    const data = { request: { requester: { id: '2', email_id: 'b@bacosa.com', name: 'B' } } };
    expect(userCanAccessRequest(user, data)).toBe(false);
  });
});

describe('userMatchesAssignedTechnician', () => {
  it('coincide por email del técnico', () => {
    const user = { email: 'tecnico@bacosa.com' };
    const data = { request: { technician: { email_id: 'tecnico@bacosa.com' } } };
    expect(userMatchesAssignedTechnician(user, data)).toBe(true);
  });

  it('coincide por udf_pick_2701 (técnico asignado como texto plano)', () => {
    const user = { name: 'Algis Morales' };
    const data = { request: { udf_fields: { udf_pick_2701: 'Algis Morales' } } };
    expect(userMatchesAssignedTechnician(user, data)).toBe(true);
  });

  it('no coincide con un técnico distinto', () => {
    const user = { name: 'Algis Morales', email: 'algis@bacosa.com' };
    const data = { request: { technician: { email_id: 'otro@bacosa.com' } } };
    expect(userMatchesAssignedTechnician(user, data)).toBe(false);
  });
});

describe('userCanReadRequest / userCanSeeListRequest', () => {
  const ownTicket = { request: { requester: { id: '7210' } } };
  const otherTicket = { request: { requester: { id: '9999' } } };
  const owner = { sdpRequesterId: '7210' };

  it('un usuario normal puede leer su propio ticket', () => {
    expect(userCanReadRequest(owner, ownTicket)).toBe(true);
  });

  it('un usuario normal NO puede leer el ticket de otro (sin listas ejecutivas ni admin configurados)', () => {
    expect(userCanReadRequest(owner, otherTicket)).toBe(false);
  });

  it('un usuario listado en SOPHIA_IT_EXECUTIVE_EMAILS sí puede leer el ticket de otro', () => {
    process.env.SOPHIA_IT_EXECUTIVE_EMAILS = 'gerente@bacosa.com';
    expect(userCanReadRequest({ email: 'gerente@bacosa.com' }, otherTicket)).toBe(true);
  });

  it('un support_admin puede leer cualquier ticket', () => {
    const admin = { role: 'support_admin' };
    expect(userCanReadRequest(admin, otherTicket)).toBe(true);
  });

  it('un líder de MCI puede leer su propia MCI aunque no sea el solicitante', () => {
    const leader = { name: 'Ana Diaz' };
    const mci = { request: { requester: { id: '999' }, template: { name: 'PlantMCI' }, udf_fields: { udf_pick_1503: 'Ana Diaz' } } };
    expect(userCanReadRequest(leader, mci)).toBe(true);
  });

  it('userCanSeeListRequest de MCI exige el mismo criterio que userCanReadRequest', () => {
    const leader = { name: 'Ana Diaz' };
    const mci = { request: { requester: { id: '999' }, template: { name: 'PlantMCI' }, udf_fields: { udf_pick_1503: 'Ana Diaz' } } };
    expect(userCanSeeListRequest(leader, mci, { isMciResult: true })).toBe(true);

    const notLeader = { name: 'Otro Usuario' };
    expect(userCanSeeListRequest(notLeader, mci, { isMciResult: true })).toBe(false);
  });
});

describe('isMciRequestData / userMatchesMciLeader', () => {
  it('detecta una MCI por nombre de plantilla', () => {
    expect(isMciRequestData({ request: { template: { name: 'PlantMCI' } } })).toBe(true);
  });

  it('detecta una MCI por id de plantilla 604', () => {
    expect(isMciRequestData({ request: { template: { id: '604' } } })).toBe(true);
  });

  it('no marca un ticket normal como MCI', () => {
    expect(isMciRequestData({ request: { template: { name: 'Incidente' } } })).toBe(false);
  });

  it('userMatchesMciLeader compara contra udf_pick_1503', () => {
    const data = { request: { udf_fields: { udf_pick_1503: 'Ana Diaz' } } };
    expect(userMatchesMciLeader({ name: 'Ana Diaz' }, data)).toBe(true);
    expect(userMatchesMciLeader({ name: 'Otra Persona' }, data)).toBe(false);
  });
});

describe('permisos de edición de MCI por un líder no admin', () => {
  it('permite solo current_date, description, predictive y progress', () => {
    const args = { fields: { progress: 80, description: 'ok' } };
    expect(getDisallowedLeaderMciUpdateFields(args)).toEqual([]);
  });

  it('rechaza campos fuera de la lista blanca, como status o leader', () => {
    const args = { fields: { status: 'Cerrado', leader: 'Otra Persona' } };
    expect(getDisallowedLeaderMciUpdateFields(args)).toEqual(['status', 'leader']);
  });

  it('mciUpdateChangesLeader detecta intentos de cambiar el líder', () => {
    expect(mciUpdateChangesLeader({ fields: { leader: 'X' } })).toBe(true);
    expect(mciUpdateChangesLeader({ fields: { progress: 50 } })).toBe(false);
  });
});
