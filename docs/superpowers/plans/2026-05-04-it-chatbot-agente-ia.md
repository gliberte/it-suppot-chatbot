# Plan de Implementación: Agente de Soporte IT Autónomo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar autenticación real via LDAPS y un cerebro de IA local (Ollama) para gestión autónoma de soporte.

**Architecture:** Orquestación en el Bridge (Express) que utiliza Ollama para razonar sobre herramientas MCP y un servicio LDAP endurecido para identidad.

**Tech Stack:** Node.js, Express, TypeScript, ldapjs, Axios, Ollama API.

---

### Task 1: Endurecimiento de LDAPS (MCP Server)

**Files:**
- Modify: `sdp-mcp-server/src/ldap-service.ts`
- Test: `sdp-mcp-server/src/test-ldap.ts` [NEW]

- [ ] **Step 1: Crear script de prueba de conexión LDAP**
```typescript
import { LdapService } from './ldap-service';
import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
    const ldap = new LdapService();
    try {
        console.log('Probando búsqueda de usuario...');
        const user = await ldap.searchUser('luis.solano@bacosa.com');
        console.log('Resultado:', user);
    } catch (e) {
        console.error('Error:', e);
    }
}
test();
```

- [ ] **Step 2: Implementar lógica de conexión real en LdapService**
Modificar `src/ldap-service.ts` para eliminar el bypass de "mock" y usar `client.bind` con las credenciales del `.env`.

- [ ] **Step 3: Ejecutar prueba y verificar conexión**
Run: `npx ts-node src/test-ldap.ts`
Expected: Datos del usuario recuperados del AD `192.170.1.250`.

- [ ] **Step 4: Commit**
```bash
git add sdp-mcp-server/src/ldap-service.ts
git commit -m "feat(ldap): implement real LDAPS connectivity"
```

---

### Task 2: Integración de IA Local (Bridge Server)

**Files:**
- Modify: `it-support-chatbot/server.js`
- Modify: `it-support-chatbot/package.json`

- [ ] **Step 1: Instalar dependencias de IA**
Run: `npm install axios` en `it-support-chatbot`.

- [ ] **Step 2: Crear el módulo AgentOrchestrator**
Implementar una función `askAI(message, history)` que envíe el prompt a Ollama.

```javascript
const axios = require('axios');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';

async function askAI(message, tools) {
    const prompt = `Eres un agente de soporte IT. Tienes acceso a estas herramientas: ${JSON.stringify(tools)}. 
    El usuario dice: "${message}". 
    Responde en formato JSON indicando si necesitas llamar a una herramienta o dar una respuesta directa.`;
    
    const response = await axios.post(OLLAMA_URL, {
        model: 'llama3',
        prompt: prompt,
        stream: false,
        format: 'json'
    });
    return JSON.parse(response.data.response);
}
```

- [ ] **Step 3: Integrar en el endpoint /api/chat**
Modificar el flujo principal para que use `askAI` antes de ejecutar cualquier acción.

- [ ] **Step 4: Commit**
```bash
git add it-support-chatbot/server.js it-support-chatbot/package.json
git commit -m "feat(ai): integrate Ollama orchestration layer"
```

---

### Task 3: Verificación End-to-End

- [ ] **Step 1: Iniciar Ollama localmente**
Run: `ollama run llama3` (Asegurar que el servicio esté activo).

- [ ] **Step 2: Probar flujo completo**
Input Chat: "¿Cuál es el estado de mi ticket de red?"
Verificar Logs:
1. Bridge recibe mensaje.
2. IA decide llamar a `sdp_list_requests`.
3. Bridge llama al MCP.
4. Respuesta final renderizada en el chat.

---
*Plan generado bajo la metodología Superpowers.*
