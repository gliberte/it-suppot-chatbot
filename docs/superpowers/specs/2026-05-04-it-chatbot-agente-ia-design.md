# Especificación de Diseño: Agente de Soporte IT Autónomo (Paso 1)

**Fecha:** 2026-05-04  
**Estado:** Para Revisión  
**Contexto:** Evolución del chatbot de soporte IT de una lógica basada en reglas a un sistema agéntico con IA local y autenticación real vía AD.

## 1. Objetivos
- Implementar autenticación real mediante **LDAPS (puerto 636)** contra el servidor `192.170.1.250`.
- Dotar al chatbot de un "cerebro" basado en **IA Local (Ollama)** para el razonamiento y uso de herramientas.
- Automatizar la consulta y gestión de tickets mediante lenguaje natural.

## 2. Arquitectura de Solución

### A. Capa de Identidad (MCP Server)
- **Componente:** `LdapService` en `sdp-mcp-server`.
- **Cambios:**
  - Sustitución de lógica Mock por conexión real.
  - Uso de variables de entorno: `LDAP_URL`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`.
  - Método `searchUser`: Búsqueda por `mail` y `sAMAccountName`.

### B. Capa de Orquestación (Bridge Server)
- **Componente:** `server.js` en `it-support-chatbot`.
- **Nuevo Módulo:** `AgentOrchestrator`.
- **Integración IA:**
  - Conexión con `http://localhost:11434/api/generate` (Ollama).
  - **System Prompt:** Define al agente como asistente de soporte IT, con acceso a herramientas de ServiceDesk Plus.
- **Flujo de Trabajo:**
  1. Recibir input del usuario.
  2. Prompting a la IA con contexto de herramientas.
  3. Ejecución de herramienta MCP (si aplica).
  4. Formateo de respuesta final para el usuario.

### C. Capa de Usuario (Frontend)
- **Componente:** React App.
- **Cambios:**
  - Soporte para renderizado dinámico de resultados de la IA.
  - Manejo de estados de "pensando" (typing indicator) mientras el agente razona.

## 3. Seguridad
- **Cifrado:** Todas las comunicaciones con el AD se realizan vía TLS (LDAPS).
- **Aislamiento:** Las credenciales del AD solo residen en el servidor backend, nunca viajan al cliente.
- **Privacidad:** Al usar IA Local (Ollama), ninguna información de los tickets o empleados sale de la infraestructura corporativa.

## 4. Plan de Pruebas (Verificación)
1. **Conexión AD:** Verificar `bind` exitoso con el servidor de dominio.
2. **Búsqueda Real:** Validar que al ingresar un correo real de la empresa, el bot devuelve el nombre del empleado.
3. **Razonamiento IA:** Preguntar "Dime mis tickets abiertos" y verificar que la IA decide llamar a `sdp_list_requests`.

---
*Documento generado bajo la metodología Superpowers.*
