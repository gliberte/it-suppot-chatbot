import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import { mockAgentProcessMessage, mockMcpRequest } from './setup.js';

function mcpText(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

const ANA = { username: 'ana.diaz', name: 'Ana Diaz', email: 'ana.diaz@bacosa.com', sdpRequesterId: '5001' };
const LUIS_ADMIN = { username: 'luis.solano', name: 'Luis Solano', email: 'luis.solano@bacosa.com', sdpRequesterId: '7210' };

function defaultMcpRouter(overrides = {}) {
  return (payload) => {
    const { name, arguments: args } = payload.params;
    if (overrides[name]) return overrides[name](args);

    if (name === 'sdp_authenticate_user') {
      const account = args.username === LUIS_ADMIN.username ? LUIS_ADMIN : ANA;
      return Promise.resolve(mcpText({ success: true, user: { name: account.name, email: account.email } }));
    }
    if (name === 'sdp_search_user') {
      const account = args.search_text?.includes('luis') ? LUIS_ADMIN : ANA;
      return Promise.resolve(mcpText({ users: [{ id: account.sdpRequesterId, name: account.name, email_id: account.email }] }));
    }
    throw new Error(`mockMcpRequest: sin manejador para la herramienta "${name}" en este test`);
  };
}

async function loginAs(account, overrides = {}) {
  mockMcpRequest.mockImplementation(defaultMcpRouter(overrides));
  const res = await request(app)
    .post('/api/login')
    .send({ username: account.username, password: 'cualquier-cosa' });
  return res;
}

beforeEach(() => {
  mockMcpRequest.mockReset();
  delete process.env.SUPPORT_ADMIN_EMAILS;
});

describe('POST /api/login', () => {
  it('autentica y devuelve un token con el usuario enriquecido por SDP', async () => {
    const res = await loginAs(ANA);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.sdpRequesterId).toBe('5001');
    expect(res.body.user.name).toBe('Ana Diaz');
  });

  it('responde 401 con credenciales inválidas', async () => {
    mockMcpRequest.mockImplementation(() => {
      throw new Error('Error de autenticación: credenciales inválidas.');
    });
    const res = await request(app).post('/api/login').send({ username: 'nadie', password: 'mal' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('requireAuth (GET /api/me)', () => {
  it('responde 401 sin token', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  it('responde 401 con un token inválido', async () => {
    const res = await request(app).get('/api/me').set('Authorization', 'Bearer token-inventado');
    expect(res.status).toBe(401);
  });

  it('responde 200 con un token válido y devuelve el usuario de la sesión', async () => {
    const login = await loginAs(ANA);
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('ana.diaz@bacosa.com');
  });
});

describe('POST /api/get-ticket-status (ownership)', () => {
  it('responde 403 si el ticket no pertenece al usuario autenticado', async () => {
    const login = await loginAs(ANA);
    mockMcpRequest.mockImplementation(defaultMcpRouter({
      sdp_get_request_details: () => Promise.resolve(mcpText({
        request: { id: '999', requester: { id: '9999', email_id: 'otro@bacosa.com' }, status: { name: 'Abierto' } }
      }))
    }));

    const res = await request(app)
      .post('/api/get-ticket-status')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ request_id: '999' });

    expect(res.status).toBe(403);
  });

  it('responde 200 si el ticket sí pertenece al usuario autenticado', async () => {
    const login = await loginAs(ANA);
    mockMcpRequest.mockImplementation(defaultMcpRouter({
      sdp_get_request_details: () => Promise.resolve(mcpText({
        request: { id: '888', requester: { id: '5001', email_id: 'ana.diaz@bacosa.com' }, status: { name: 'Abierto' } }
      }))
    }));

    const res = await request(app)
      .post('/api/get-ticket-status')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ request_id: '888' });

    expect(res.status).toBe(200);
    expect(res.body.request.id).toBe('888');
  });
});

describe('POST /api/list-requests (scoping)', () => {
  it('un usuario normal siempre queda acotado a su propio requester_id', async () => {
    const login = await loginAs(ANA);
    let capturedArgs;
    mockMcpRequest.mockImplementation(defaultMcpRouter({
      sdp_list_requests: (args) => {
        capturedArgs = args;
        return Promise.resolve(mcpText({ requests: [] }));
      }
    }));

    await request(app)
      .post('/api/list-requests')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ scope: 'all' }); // un usuario normal no puede forzar scope=all

    expect(capturedArgs.requester_id).toBe('5001');
  });

  it('un support_admin con scope=all consulta sin acotar por requester_id', async () => {
    process.env.SUPPORT_ADMIN_EMAILS = LUIS_ADMIN.email;
    const login = await loginAs(LUIS_ADMIN);
    let capturedArgs;
    mockMcpRequest.mockImplementation(defaultMcpRouter({
      sdp_list_requests: (args) => {
        capturedArgs = args;
        return Promise.resolve(mcpText({ requests: [] }));
      }
    }));

    await request(app)
      .post('/api/list-requests')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ scope: 'all' });

    expect(capturedArgs.requester_id).toBeUndefined();
  });

  it('un support_admin sin scope=all sigue acotado a su propio requester_id', async () => {
    process.env.SUPPORT_ADMIN_EMAILS = LUIS_ADMIN.email;
    const login = await loginAs(LUIS_ADMIN);
    let capturedArgs;
    mockMcpRequest.mockImplementation(defaultMcpRouter({
      sdp_list_requests: (args) => {
        capturedArgs = args;
        return Promise.resolve(mcpText({ requests: [] }));
      }
    }));

    await request(app)
      .post('/api/list-requests')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({});

    expect(capturedArgs.requester_id).toBe('7210');
  });
});

describe('POST /api/create-ticket (confirmación explícita del lado web)', () => {
  it('sin confirmed:true responde 409 y no llama a SDP', async () => {
    const login = await loginAs(ANA);
    const res = await request(app)
      .post('/api/create-ticket')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ subject: 'No puedo acceder a SAP', description: 'Usuario o contraseña incorrectos', confirmed: false });

    expect(res.status).toBe(409);
    expect(mockMcpRequest).not.toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ name: 'sdp_create_request' })
    }));
  });

  it('con confirmed:true crea el ticket con el solicitante de la sesión, no uno enviado por el cliente', async () => {
    const login = await loginAs(ANA);
    let capturedArgs;
    mockMcpRequest.mockImplementation(defaultMcpRouter({
      sdp_create_request: (args) => {
        capturedArgs = args;
        return Promise.resolve(mcpText({ request: { id: '4242' } }));
      }
    }));

    const res = await request(app)
      .post('/api/create-ticket')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        subject: 'No puedo acceder a SAP',
        description: 'Usuario o contraseña incorrectos',
        confirmed: true,
        // Un cliente comprometido no debería poder suplantar a otro solicitante:
        requester_id: '9999'
      });

    expect(res.status).toBe(200);
    expect(capturedArgs.requester_id).toBe('5001');
  });
});

describe('POST /api/chat + POST /api/confirm-action (ciclo completo vía IA)', () => {
  it('una acción que requiere confirmación queda pendiente y solo se ejecuta al confirmar', async () => {
    const login = await loginAs(ANA);

    mockAgentProcessMessage.mockResolvedValue({
      action: 'call_tool',
      tool_name: 'sdp_execute_automation_action',
      tool_args: { action_type: 'UNLOCK_ACCOUNT', request_id: '777' },
      content: 'Preparo el desbloqueo de tu cuenta.'
    });

    let automationExecuted = false;
    mockMcpRequest.mockImplementation(defaultMcpRouter({
      sdp_get_request_details: () => Promise.resolve(mcpText({
        request: { id: '777', requester: { id: '5001', email_id: 'ana.diaz@bacosa.com' }, status: { name: 'Abierto' } }
      })),
      sdp_execute_automation_action: () => {
        automationExecuted = true;
        return Promise.resolve(mcpText({ status: 'success', message: 'Cuenta desbloqueada.' }));
      }
    }));

    const chatRes = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ message: 'mensaje de prueba sin patrón especial 12345', history: [] });

    expect(mockAgentProcessMessage).toHaveBeenCalled();
    expect(automationExecuted).toBe(false); // todavía no se ejecutó, solo quedó pendiente

    const events = chatRes.text
      .split('\n\n')
      .filter((chunk) => chunk.startsWith('data: '))
      .map((chunk) => JSON.parse(chunk.slice('data: '.length)));
    const confirmationEvent = events.find((event) => event.type === 'confirmation_required');
    expect(confirmationEvent).toBeTruthy();
    expect(confirmationEvent.actionId).toBeTruthy();

    const confirmRes = await request(app)
      .post('/api/confirm-action')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ actionId: confirmationEvent.actionId });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.success).toBe(true);
    expect(automationExecuted).toBe(true);
  });

  it('confirmar un actionId inexistente responde 404 y no ejecuta nada', async () => {
    const login = await loginAs(ANA);
    const res = await request(app)
      .post('/api/confirm-action')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ actionId: 'no-existe' });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/chat: registro de cumpleaños intercepta antes de llegar a la IA', () => {
  it('un mensaje con fecha reconocible se registra sin invocar a AgentOrchestrator', async () => {
    const login = await loginAs(ANA);
    mockAgentProcessMessage.mockClear();

    const chatRes = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ message: 'mi cumpleaños es el 15 de marzo', history: [] });

    const events = chatRes.text
      .split('\n\n')
      .filter((chunk) => chunk.startsWith('data: '))
      .map((chunk) => JSON.parse(chunk.slice('data: '.length)));
    const textEvent = events.find((event) => event.type === 'text');

    expect(textEvent?.content).toContain('Guardé tu cumpleaños');
    expect(textEvent?.content).toContain('15 de marzo');
    expect(mockAgentProcessMessage).not.toHaveBeenCalled();
  });

  it('borrar un cumpleaños que no existe responde sin invocar a AgentOrchestrator', async () => {
    const login = await loginAs(ANA);
    mockAgentProcessMessage.mockClear();

    const chatRes = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ message: 'borra mi cumpleaños', history: [] });

    const events = chatRes.text
      .split('\n\n')
      .filter((chunk) => chunk.startsWith('data: '))
      .map((chunk) => JSON.parse(chunk.slice('data: '.length)));
    const textEvent = events.find((event) => event.type === 'text');

    expect(textEvent?.content).toContain('No tenía tu cumpleaños guardado');
    expect(mockAgentProcessMessage).not.toHaveBeenCalled();
  });
});
