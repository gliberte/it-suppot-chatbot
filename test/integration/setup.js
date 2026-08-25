import { vi } from 'vitest';

// Mocks globales para los tests de integracion de server.js. Se cargan una
// vez (setupFiles en vitest.config.js) y aplican a todos los archivos de
// test, para que ninguno intente conectar de verdad a ServiceDesk Plus,
// LDAP, Gemini o Microsoft Teams.

export const mockMcpRequest = vi.fn();
export const mockAgentProcessMessage = vi.fn();
export const mockSendActivity = vi.fn(async () => ({ id: 'mock-resource-id' }));
export const mockContinueConversation = vi.fn(async (appId, reference, callback) => {
  const fakeContext = {
    activity: {
      conversation: { id: reference?.conversationId || 'mock-conversation-id' },
      from: reference?.user || { id: 'mock-from-id' }
    },
    sendActivity: mockSendActivity
  };
  await callback(fakeContext);
});

function defaultReadFileImpl() {
  return Promise.reject(Object.assign(new Error('ENOENT (mock)'), { code: 'ENOENT' }));
}
export const mockReadFile = vi.fn(defaultReadFileImpl);

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

class MockCloudAdapter {
  async process() {
    // No usado en estos tests: /api/teams/messages requeriria un token real
    // de Bot Framework, fuera del alcance de esta suite.
  }

  async continueConversationAsync(...args) {
    return mockContinueConversation(...args);
  }
}

class MockConfigurationBotFrameworkAuthentication {}

class MockTeamsActivityHandler {
  onMessage() {
    // no-op: nada en estos tests dispara el webhook de Teams
  }
}

const MockTurnContext = {
  getConversationReference: (activity) => ({ conversationId: activity?.conversation?.id })
};

vi.mock('botbuilder', () => ({
  CloudAdapter: MockCloudAdapter,
  ConfigurationBotFrameworkAuthentication: MockConfigurationBotFrameworkAuthentication,
  TeamsActivityHandler: MockTeamsActivityHandler,
  TurnContext: MockTurnContext
}));

// auditToolCall/auditTeamsEvent/etc. escriben con rutas fijas (path.join(__dirname, 'audit.log'),
// no configurables por env var). Sin este mock, correr los tests ensuciaria
// los logs reales del proyecto en cada corrida. readFile es controlable por
// prueba (mockReadFile) para poder simular un estado previo guardado en un
// store JSON especifico sin tocar el disco real.
vi.mock('fs/promises', () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  readFile: (...args) => mockReadFile(...args)
}));
