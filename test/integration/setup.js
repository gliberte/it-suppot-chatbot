import { vi } from 'vitest';

// Mocks globales para los tests de integracion de server.js. Se cargan una
// vez (setupFiles en vitest.config.js) y aplican a todos los archivos de
// test, para que ninguno intente conectar de verdad a ServiceDesk Plus,
// LDAP, Gemini o Microsoft Teams.

export const mockMcpRequest = vi.fn();
export const mockAgentProcessMessage = vi.fn();

class MockClient {
  connect() {
    return Promise.resolve();
  }

  request(...args) {
    return mockMcpRequest(...args);
  }
}

class MockStdioClientTransport {}

class MockGoogleGenerativeAI {
  getGenerativeModel() {
    return {
      generateContent: () => Promise.resolve({
        response: { text: () => JSON.stringify({ action: 'reply', content: '(respuesta simulada de Gemini en test)' }) }
      }),
      embedContent: () => Promise.resolve({ embedding: { values: [] } })
    };
  }
}

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: MockStdioClientTransport
}));

vi.mock('../../agent-orchestrator.js', () => ({
  AgentOrchestrator: {
    processMessage: (...args) => mockAgentProcessMessage(...args)
  }
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: MockGoogleGenerativeAI
}));

// auditToolCall/auditTeamsEvent/etc. escriben con rutas fijas (path.join(__dirname, 'audit.log'),
// no configurables por env var). Sin este mock, correr los tests ensuciaria
// los logs reales del proyecto en cada corrida.
vi.mock('fs/promises', () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT (mock)'), { code: 'ENOENT' }))
}));
