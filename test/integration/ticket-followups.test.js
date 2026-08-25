import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, teamsConversationReferences } from '../../server.js';
import { mockMcpRequest, mockReadFile, mockSendActivity } from './setup.js';

function mcpText(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function mockStoredFollowupState(tickets) {
  mockReadFile.mockImplementation((filePath) => {
    if (String(filePath).includes('ticket_followup_state.json')) {
      return Promise.resolve(JSON.stringify({ updatedAt: '2026-08-01T00:00:00.000Z', tickets }));
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

describe('POST /api/admin/ticket-followups/trigger', () => {
  it('avisa en privado cuando un ticket ya vigilado recibe un seguimiento nuevo', async () => {
    teamsConversationReferences.set('ana.diaz@bacosa.com', { conversationId: 'conv-ana' });
    mockStoredFollowupState({
      777: { lastUpdatedTime: 1000, lastNoteTimestamp: null, requesterEmail: 'ana.diaz@bacosa.com' }
    });

    mockMcpRequest.mockImplementation((payload) => {
      const { name, arguments: args } = payload.params;
      if (name === 'sdp_list_requests') {
        return Promise.resolve(mcpText({
          requests: [{
            id: '777',
            subject: 'No puedo acceder a SAP',
            status: { name: 'En Proceso' },
            last_updated_time: 2000,
            requester: { id: '5001', email_id: 'ana.diaz@bacosa.com' }
          }]
        }));
      }
      if (name === 'sdp_get_request_details' && args.request_id === '777') {
        return Promise.resolve(mcpText({
          request: {
            id: '777',
            notes: [{
              description: 'Ya revisamos tu caso, seguimos trabajando en ello.',
              created_time: 1700,
              created_by: { name: 'Kassim Acevedo' }
            }]
          }
        }));
      }
      throw new Error(`sin manejador para ${name}`);
    });

    const res = await request(app).post('/api/admin/ticket-followups/trigger').send({});

    expect(res.status).toBe(200);
    expect(res.body.checkedCount).toBe(1);
    expect(res.body.notifiedCount).toBe(1);
    expect(mockSendActivity).toHaveBeenCalledTimes(1);
    const sentActivity = mockSendActivity.mock.calls[0][0];
    expect(sentActivity.text).toContain('#777');
    expect(sentActivity.text).toContain('Kassim Acevedo');
    expect(sentActivity.text).toContain('Ya revisamos tu caso');
  });

  it('no avisa la primera vez que ve un ticket, solo establece la línea base', async () => {
    teamsConversationReferences.set('ana.diaz@bacosa.com', { conversationId: 'conv-ana' });
    mockStoredFollowupState({}); // sin estado previo para el ticket 777

    mockMcpRequest.mockImplementation((payload) => {
      if (payload.params.name === 'sdp_list_requests') {
        return Promise.resolve(mcpText({
          requests: [{
            id: '777',
            subject: 'No puedo acceder a SAP',
            status: { name: 'Abierto' },
            last_updated_time: 2000,
            requester: { id: '5001', email_id: 'ana.diaz@bacosa.com' }
          }]
        }));
      }
      throw new Error(`sin manejador para ${payload.params.name}`);
    });

    const res = await request(app).post('/api/admin/ticket-followups/trigger').send({});

    expect(res.status).toBe(200);
    expect(res.body.checkedCount).toBe(0);
    expect(res.body.notifiedCount).toBe(0);
    expect(mockSendActivity).not.toHaveBeenCalled();
  });

  it('no avisa si el solicitante no tiene conversación de Teams guardada', async () => {
    // teamsConversationReferences vacío a propósito: nadie a quién avisar.
    mockStoredFollowupState({
      777: { lastUpdatedTime: 1000, lastNoteTimestamp: null, requesterEmail: 'ana.diaz@bacosa.com' }
    });

    mockMcpRequest.mockImplementation((payload) => {
      if (payload.params.name === 'sdp_list_requests') {
        return Promise.resolve(mcpText({
          requests: [{
            id: '777',
            status: { name: 'En Proceso' },
            last_updated_time: 2000,
            requester: { id: '5001', email_id: 'ana.diaz@bacosa.com' }
          }]
        }));
      }
      throw new Error(`sin manejador para ${payload.params.name}`);
    });

    const res = await request(app).post('/api/admin/ticket-followups/trigger').send({});

    expect(res.status).toBe(200);
    expect(res.body.notifiedCount).toBe(0);
    expect(mockSendActivity).not.toHaveBeenCalled();
  });
});
