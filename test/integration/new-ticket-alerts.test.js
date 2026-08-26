import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, teamsConversationReferences } from '../../server.js';
import { mockMcpRequest, mockReadFile, mockSendActivity } from './setup.js';

function mcpText(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function mockStoredWatermark(lastSeenCreatedTime) {
  mockReadFile.mockImplementation((filePath) => {
    if (String(filePath).includes('new_ticket_alerts_state.json')) {
      return Promise.resolve(JSON.stringify({ updatedAt: '2026-08-01T00:00:00.000Z', lastSeenCreatedTime }));
    }
    return Promise.reject(Object.assign(new Error('ENOENT (mock)'), { code: 'ENOENT' }));
  });
}

beforeEach(() => {
  mockMcpRequest.mockReset();
  mockSendActivity.mockClear();
  mockReadFile.mockReset();
  teamsConversationReferences.clear();
});

afterEach(() => {
  delete process.env.IT_TECHNICAL_STAFF_EMAILS;
});

describe('POST /api/admin/new-ticket-alerts/trigger', () => {
  it('avisa al personal técnico IT cuando hay un ticket creado después de la línea base', () => {
    process.env.IT_TECHNICAL_STAFF_EMAILS = 'kassim.acevedo@bacosa.com';
    teamsConversationReferences.set('kassim.acevedo@bacosa.com', { conversationId: 'conv-kassim' });
    mockStoredWatermark(1000);

    mockMcpRequest.mockImplementation((payload) => {
      if (payload.params.name === 'sdp_list_requests') {
        return Promise.resolve(mcpText({
          requests: [{
            id: '13900',
            subject: 'No puedo acceder a SAP',
            created_time: 2000,
            requester: { name: 'Ana Diaz', email_id: 'ana.diaz@bacosa.com' },
            category: { name: 'Contraseñas' },
            subcategory: { name: 'SAP' },
            priority: { name: 'Alta' }
          }]
        }));
      }
      throw new Error(`sin manejador para ${payload.params.name}`);
    });

    return request(app).post('/api/admin/new-ticket-alerts/trigger').send({}).then((res) => {
      expect(res.status).toBe(200);
      expect(res.body.newTicketsCount).toBe(1);
      expect(res.body.notifiedCount).toBe(1);
      expect(mockSendActivity).toHaveBeenCalledTimes(1);
      const sentActivity = mockSendActivity.mock.calls[0][0];
      expect(sentActivity.text).toContain('#13900');
      expect(sentActivity.text).toContain('Ana Diaz');
      expect(sentActivity.text).toContain('Contraseñas / SAP');
    });
  });

  it('no avisa en el primer sondeo (sin línea base previa), solo la establece', async () => {
    process.env.IT_TECHNICAL_STAFF_EMAILS = 'kassim.acevedo@bacosa.com';
    teamsConversationReferences.set('kassim.acevedo@bacosa.com', { conversationId: 'conv-kassim' });
    mockStoredWatermark(null);

    mockMcpRequest.mockImplementation((payload) => {
      if (payload.params.name === 'sdp_list_requests') {
        return Promise.resolve(mcpText({
          requests: [{ id: '13900', subject: 'Ticket ya existente', created_time: 2000, requester: { name: 'Ana Diaz' } }]
        }));
      }
      throw new Error(`sin manejador para ${payload.params.name}`);
    });

    const res = await request(app).post('/api/admin/new-ticket-alerts/trigger').send({});

    expect(res.status).toBe(200);
    expect(res.body.newTicketsCount).toBe(0);
    expect(res.body.notifiedCount).toBe(0);
    expect(mockSendActivity).not.toHaveBeenCalled();
  });

  it('no avisa si nadie en IT_TECHNICAL_STAFF_EMAILS tiene conversación de Teams guardada', async () => {
    process.env.IT_TECHNICAL_STAFF_EMAILS = 'kassim.acevedo@bacosa.com';
    // teamsConversationReferences vacío a propósito
    mockStoredWatermark(1000);

    mockMcpRequest.mockImplementation((payload) => {
      if (payload.params.name === 'sdp_list_requests') {
        return Promise.resolve(mcpText({
          requests: [{ id: '13900', subject: 'Ticket nuevo', created_time: 2000, requester: { name: 'Ana Diaz' } }]
        }));
      }
      throw new Error(`sin manejador para ${payload.params.name}`);
    });

    const res = await request(app).post('/api/admin/new-ticket-alerts/trigger').send({});

    expect(res.status).toBe(200);
    expect(res.body.newTicketsCount).toBe(1); // sí se detectó el ticket nuevo...
    expect(res.body.notifiedCount).toBe(0); // ...pero no hay a quién avisarle
    expect(mockSendActivity).not.toHaveBeenCalled();
  });
});
