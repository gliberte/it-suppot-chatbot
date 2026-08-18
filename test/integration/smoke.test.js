import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';

describe('smoke: server.js se puede importar y responder sin infraestructura real', () => {
  it('GET /api/teams/health responde sin necesitar MCP/Gemini/Teams reales', async () => {
    const res = await request(app).get('/api/teams/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
