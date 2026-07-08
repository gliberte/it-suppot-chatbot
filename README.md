# IT Support Chatbot

Chat interno de soporte IT para Barraza y Cia. La app combina una interfaz React, un bridge Express, Gemini Cloud para razonamiento/resumen y un servidor MCP separado para hablar con ServiceDesk Plus y Active Directory.

## Arquitectura

```text
React/Vite
  -> Express Bridge (:3001)
    -> Gemini Cloud
    -> MCP Client por STDIO
      -> sdp-mcp-server
        -> ServiceDesk Plus API
        -> LDAP/AD
```

## Comandos

```bash
npm run dev          # frontend Vite
npm run dev:server   # bridge Express
npm run teams:check   # valida variables minimas para piloto Teams
npm run teams:package # genera teams/generated/soporte-it-teams.zip
npm run rag:ingest    # genera data/rag-index.json desde knowledge/
npm run build        # typecheck + build frontend
npm run lint         # eslint
```

El servidor MCP debe estar compilado en `../sdp-mcp-server/build/index.js` antes de levantar el bridge.

## Variables

Ver `.env.example`. Las variables clave son:

- `GEMINI_API_KEY`
- `CLIENT_ORIGIN`
- `SESSION_TTL_MS`
- `PENDING_ACTION_TTL_MS`
- `GEMINI_DECISION_MODEL`
- `GEMINI_SUMMARY_MODEL`
- `GEMINI_FALLBACK_MODEL`
- `GEMINI_EMBEDDING_MODEL`
- `RAG_ENABLED`
- `RAG_KNOWLEDGE_DIR`
- `RAG_INDEX_PATH`
- `SDP_URL`
- `SDP_API_KEY`
- `SDP_DEFAULT_*`
- `SDP_SAP_*`
- `SDP_NETWORK_*`
- `SDP_PRINTER_*`
- `SDP_PASSWORD_*`
- `LDAP_URL`
- `LDAP_BASE_DN`
- `LDAP_BIND_DN`
- `LDAP_BIND_PASSWORD`
- `LDAP_REJECT_UNAUTHORIZED`
- `MICROSOFT_APP_ID`
- `MICROSOFT_APP_PASSWORD`
- `AZURE_TENANT_ID`
- `TEAMS_ALLOWED_CONVERSATION_IDS`
- `TEAMS_GRAPH_USER_LOOKUP`
- `TEAMS_AUDIT_ENABLED`
- `TEAMS_USER_OVERRIDES`

## Decision IA

El proyecto usa Gemini Cloud como proveedor de IA. Esto implica que los prompts y resultados tecnicos enviados para razonamiento/resumen deben considerarse datos compartidos con el proveedor cloud aprobado.

## RAG De Conocimiento

Sophia puede recuperar conocimiento interno antes de decidir si responde o usa una herramienta. El MVP usa documentos Markdown en `knowledge/` y un indice local `data/rag-index.json`.

Flujo de mantenimiento:

```bash
# Editar o agregar archivos .md en knowledge/
npm run rag:ingest
npm run rag:test
npm run dev:server
```

El indice generado queda ignorado por git. Para cambiar el contenido versionado, editar los documentos fuente en `knowledge/`.

Metadata soportada en cada documento:

```markdown
---
title: Nombre visible
doc_type: procedure
area: sap
visibility: all
---
```

Visibilidad:

- `all`: usuarios normales y admins.
- `admin`: solo administradores de soporte.
- `mci_admin`: administradores de soporte o MCI.

El RAG no reemplaza datos vivos de SDP. Estados, tickets, solicitantes, MCI y acciones reales siguen consultandose con herramientas MCP.

Diagnostico de recuperacion:

```bash
TOKEN="<token de localStorage: it_support_token>"
curl -G "http://localhost:3001/api/rag/search" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=consulta de usuario SAP produccion por lote"
```

Parametros opcionales:

- `limit`: cantidad maxima de fragmentos.
- `minScore`: umbral minimo de similitud. Para depurar, usar un valor bajo como `0.3`.

Ejemplo:

```bash
curl -G "http://localhost:3001/api/rag/search" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=consulta de usuario SAP produccion por lote" \
  --data-urlencode "minScore=0.3"
```

Diagnostico de clasificacion de tickets:

```bash
curl -X POST "http://localhost:3001/api/rag/classify-ticket" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Solicitud: Informe de Devolucion por Clientes + Produccion por Lote",
    "description": "Se requiere una consulta de usuario en SAP: Herramientas > Consultas de Usuario > 8.Calidad."
  }'
```

La respuesta incluye:

- categoria, subcategoria, prioridad y tipo sugeridos;
- ruta de clasificacion y palabras clave que hicieron match;
- confianza;
- evidencia RAG usada para justificar la decision.

## Seguridad Implementada

- Login contra AD por medio del MCP.
- Sesiones con token Bearer emitido por el bridge.
- El backend ignora contexto de usuario enviado desde el cliente y usa la sesion.
- Listado de tickets filtrado por solicitante SDP.
- Consulta de detalle bloqueada si el ticket no pertenece al usuario autenticado.
- Acciones mutantes requieren confirmacion explicita con `actionId` pendiente.
- Las acciones pendientes expiran.
- Auditoria de tool calls en `audit.log`.
- Markdown sanitizado antes de renderizarse en React.
- Resultados de SDP minimizados/redactados antes de enviarse a Gemini Cloud.
- Canal de Teams usa el mismo control de herramientas, ownership, confirmacion explicita y auditoria que la UI web.

## Minimizacion Para Gemini Cloud

El bridge mantiene el resultado completo de SDP solo para validaciones internas, como comprobar dueño del ticket. Antes de enviar datos a Gemini para resumen:

- conserva campos operativos utiles: ID, asunto, estado, prioridad, categoria, subcategoria, tipo, tecnico, fechas y descripcion corta;
- elimina URLs internas de perfiles/imagenes;
- reemplaza emails por dominio;
- redacta telefonos, emails y URLs dentro de texto libre;
- trunca descripciones/resoluciones largas;
- limita listas a 25 elementos;
- reduce los argumentos guardados en `audit.log`.

## Auditoría

Para revisar tickets creados por Sophia:

```bash
npm run audit:created-tickets
```

Opciones:

```bash
npm run audit:created-tickets -- --confirmed
npm run audit:created-tickets -- --errors
npm run audit:created-tickets -- --limit 100
npm run audit:created-tickets -- --since 2026-07-01T00:00:00Z
npm run audit:created-tickets -- --format md --output reports/created-tickets.md
npm run audit:created-tickets -- --format json --output reports/created-tickets.json
```

El reporte muestra usuario, ticket, categoria, subcategoria, ruta RAG, confianza, fuente principal y error resumido cuando la creación fue clasificada con el sistema RAG o falló contra SDP.

## Operacion En Produccion

El runbook operativo de Sophia en Linux/Nginx/Azure Bot esta en:

```text
docs/runbook-produccion.md
```

Incluye comandos de health check, monitoreo de Nginx, logs de `sophia.service`, revision segura de `.env`, checklist de corte a produccion y diagnostico de conectividad con Azure Bot/FortiGate.

El plan de pruebas funcionales para validar Sophia en Teams, SDP, MCI, roles y formato de respuestas esta en:

```text
docs/plan-pruebas-funcionales.md
```

## Validación De Ruteos

Para revisar que las rutas de creación de tickets apunten a categorías/subcategorías observadas en el catálogo o histórico local de SDP:

```bash
npm run routing:check
```

El comando valida las rutas usadas por Sophia desde `ticket-routing.js` contra:

- `reports/sdp-catalog-report-2026-07-01.md`
- `../sdp-mcp-server/ticket_history.json`

Si una subcategoría no aparece bajo su categoría, el comando falla antes de que el error llegue a ServiceDesk Plus.

## Ruteo De Tickets

La creacion de tickets aplica defaults obligatorios de ServiceDesk Plus y luego intenta clasificar por palabras clave:

- SAP: `sap`, `business one`, `b1`
- Acceso SAP: `no puedo acceder a sap`, `acceso a sap`, `login sap`, `contraseña sap`
- Red: `wifi`, `wi-fi`, `red`, `internet`, `vpn`
- Impresoras: `impresora`, `imprimir`, `etiqueta`, `zebra`, `printer`
- Password/acceso: `contraseña`, `clave`, `password`, `bloqueada`, `bloqueado`

Cada grupo puede configurarse con variables como `SDP_SAP_CATEGORY`, `SDP_SAP_SUBCATEGORY`, `SDP_SAP_PRIORITY` y `SDP_SAP_UDF_PICK_2701`. Si no hay match, se usan `SDP_DEFAULT_*`.

Rutas reales configuradas a partir del catálogo SDP:

- SAP funcional: `SAP / Problemas en Modulos`
- Acceso/login SAP: `Contraseñas / SAP`
- Red: `Red`
- Impresoras: `Impresoras / Honeywell`

Para descubrir catálogos reales de ServiceDesk Plus, iniciar sesión en la UI y consultar el endpoint protegido:

```bash
TOKEN="<token de localStorage: it_support_token>"
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3001/api/sdp-catalogs?type=all"
```

Tipos soportados:

- `all`
- `categories`
- `subcategories`
- `priorities`
- `request_types`
- `templates`
- `fields`

El MCP probará varios endpoints candidatos y devolverá los datos encontrados o los errores por endpoint. Con esa salida se ajustan las variables `SDP_*_CATEGORY`, `SDP_*_SUBCATEGORY`, `SDP_*_PRIORITY` y `SDP_*_UDF_PICK_2701`.

## Sophia En Microsoft Teams

Sophia se implementa como una app personal de Microsoft Teams con bot, no como incoming webhook ni como canal compartido de un equipo. Cada usuario corporativo debe chatear con Sophia en su propio chat 1:1 para mantener privacidad de tickets, confirmaciones e identidad.

Endpoint del bot:

```text
POST https://<tu-dominio-publico>/api/teams/messages
```

Flujo recomendado:

1. Registrar un Azure Bot en el tenant corporativo.
2. Configurar el Messaging endpoint con `/api/teams/messages`.
3. Habilitar el canal Microsoft Teams en el recurso del bot.
4. Crear o actualizar el Teams app manifest con el `botId` igual a `MICROSOFT_APP_ID` y scope `personal`.
5. Publicar Sophia como app corporativa o instalarla para usuarios piloto.
6. Configurar variables de entorno y reiniciar el bridge.

Hay una plantilla base en `teams/manifest.template.json`. Para empaquetarla en Teams hay que reemplazar `${MICROSOFT_APP_ID}` y `${PUBLIC_APP_DOMAIN}`, agregar los iconos `color.png` y `outline.png`, y comprimir esos archivos en un `.zip` de app de Teams.

El proyecto incluye un generador simple que crea el manifest final, iconos PNG basicos y el zip instalable:

```bash
MICROSOFT_APP_ID="<app-id-del-bot>" PUBLIC_APP_DOMAIN="<dominio-publico-sin-https>" npm run teams:package
```

El paquete queda en:

```text
teams/generated/soporte-it-teams.zip
```

Para validar la configuracion del bridge antes de conectarlo con Teams:

```bash
curl http://localhost:3001/api/teams/health
```

Variables:

- `MICROSOFT_APP_ID`: Application/client ID del bot.
- `MICROSOFT_APP_PASSWORD`: client secret del bot.
- `MICROSOFT_APP_TYPE`: `SingleTenant` para bots creados solo en el tenant corporativo; `MultiTenant` para bots multi-tenant.
- `AZURE_TENANT_ID`: tenant ID de Microsoft Entra ID.
- `PUBLIC_APP_DOMAIN`: dominio publico usado para generar el paquete de Teams, sin `https://`.
- `TEAMS_GRAPH_USER_LOOKUP`: si es `true`, el bridge intenta resolver el usuario de Teams por Microsoft Graph usando su `AAD Object ID`.
- `TEAMS_AUDIT_ENABLED`: si no es `false`, registra eventos de Teams en `teams-audit.log`.
- `TEAMS_DEV_TEST_TOKEN`: habilita `/api/teams/dev-message` para simular mensajes de Teams en laboratorio.
- `TEAMS_ALLOWED_TENANT_IDS`: lista opcional separada por comas para limitar el bot al tenant corporativo. Si no se configura, usa `AZURE_TENANT_ID`.
- `TEAMS_ALLOWED_CONVERSATION_IDS`: lista opcional separada por comas para limitar el bot a conversaciones/canales aprobados. En produccion con chat personal debe quedar vacia.
- `TEAMS_ADMIN_AAD_OBJECT_IDS`: lista separada por comas de usuarios Teams con rol de soporte/admin.
- `SUPPORT_ADMIN_EMAILS`: lista separada por comas de correos con rol de soporte/admin.
- `SUPPORT_ADMIN_SDP_REQUESTER_IDS`: lista separada por comas de requester IDs SDP con rol de soporte/admin.
- `MCI_ADMIN_AAD_OBJECT_IDS`: lista separada por comas de usuarios Teams con administración MCI.
- `MCI_ADMIN_EMAILS`: lista separada por comas de correos con administración MCI.
- `MCI_ADMIN_SDP_REQUESTER_IDS`: lista separada por comas de requester IDs SDP con administración MCI.
- `TEAMS_USER_OVERRIDES`: JSON para vincular usuarios de Teams con solicitantes SDP.

Ejemplo de `TEAMS_USER_OVERRIDES`:

```json
{
  "aad-object-id-del-usuario": {
    "name": "Luis Solano",
    "email": "luis.solano@bacosa.com",
    "sdpRequesterId": "7210"
  }
}
```

Si un usuario no esta vinculado, el bot responde con su `AAD Object ID` para que IT pueda agregarlo al mapa. Las acciones mutantes en Teams quedan pendientes y se ejecutan solo si el usuario responde `CONFIRMAR`; puede responder `CANCELAR` para descartarlas.

### Piloto Local Con URL Publica

1. Levantar el bridge:

```bash
npm run dev:server
```

2. Publicar el puerto `3001` con una URL HTTPS temporal usando la herramienta aprobada por IT, por ejemplo ngrok, Cloudflare Tunnel, Azure Dev Tunnels o un reverse proxy corporativo.

3. Configurar:

```env
PUBLIC_APP_DOMAIN=<dominio-publico-sin-https>
MICROSOFT_APP_ID=<app-id-del-bot>
MICROSOFT_APP_PASSWORD=<client-secret-del-bot>
TEAMS_AUDIT_ENABLED=true
```

4. Revisar preflight:

```bash
npm run teams:check
```

5. En Azure Bot, configurar el Messaging endpoint:

```text
https://<PUBLIC_APP_DOMAIN>/api/teams/messages
```

6. Generar el paquete de Teams:

```bash
MICROSOFT_APP_ID="<app-id-del-bot>" PUBLIC_APP_DOMAIN="<dominio-publico-sin-https>" npm run teams:package
```

7. Subir `teams/generated/soporte-it-teams.zip` a Teams y escribir un mensaje a Sophia en chat personal.

8. Si el usuario aun no esta mapeado, revisar:

```bash
tail -n 20 teams-audit.log
```

El log muestra `aadObjectId` y `conversationId`. Con `aadObjectId` se puede completar `TEAMS_USER_OVERRIDES`; con `conversationId` se puede cerrar `TEAMS_ALLOWED_CONVERSATION_IDS` para que el bot solo responda en el canal/chat aprobado.

### Modo Produccion En Chat Personal

En produccion Sophia debe funcionar en su propio chat con cada usuario corporativo. Para ese modo:

```env
TEAMS_ALLOWED_CONVERSATION_IDS=
TEAMS_ALLOWED_TENANT_IDS=<tenant-id-corporativo>
TEAMS_DEV_TEST_TOKEN=
TEAMS_GRAPH_USER_LOOKUP=true
```

La seguridad no depende del grupo de Teams, sino de:

- validacion del token de Teams/Bot Framework;
- tenant permitido por `TEAMS_ALLOWED_TENANT_IDS`;
- resolucion de identidad por Microsoft Graph;
- vinculacion a solicitante SDP por correo;
- ownership checks antes de consultar o modificar tickets;
- confirmacion explicita antes de acciones mutantes.

Distribucion recomendada:

1. Subir `teams/generated/soporte-it-teams.zip` en Teams Admin Center como custom app corporativa.
2. Permitir la app para la organizacion.
3. Usar Teams app setup policies para instalar Sophia automaticamente a todos los usuarios o a grupos piloto.
4. Opcionalmente fijar Sophia en la barra lateral de Teams para que todos sepan donde iniciar el chat.

### Prueba Local Sin Azure

Para probar el flujo de Teams sin instalar aun la app en Teams, configurar un token temporal:

```env
TEAMS_DEV_TEST_TOKEN=<token-largo-local>
```

Luego levantar el bridge y enviar un mensaje simulado:

```bash
curl -X POST "http://localhost:3001/api/teams/dev-message" \
  -H "Content-Type: application/json" \
  -H "x-teams-dev-token: <token-largo-local>" \
  -d '{
    "text": "Crea un ticket porque no puedo acceder a SAP desde mi laptop",
    "aadObjectId": "aad-object-id",
    "name": "Luis Solano",
    "conversationId": "dev-conversation"
  }'
```

Si `aadObjectId` esta en `TEAMS_USER_OVERRIDES`, el bridge ejecutara el mismo flujo del bot real, incluyendo confirmacion por texto. Si no esta mapeado, respondera con instrucciones y registrara `user_not_mapped` en `teams-audit.log`.

Para confirmar una accion pendiente en esa misma conversacion:

```bash
curl -X POST "http://localhost:3001/api/teams/dev-message" \
  -H "Content-Type: application/json" \
  -H "x-teams-dev-token: <token-largo-local>" \
  -d '{
    "text": "CONFIRMAR",
    "aadObjectId": "aad-object-id",
    "name": "Luis Solano",
    "conversationId": "dev-conversation"
  }'
```

### Identidad De Usuarios En Teams

Para piloto, usar `TEAMS_USER_OVERRIDES` es suficiente y evita depender de permisos extra en Microsoft Graph.

Para produccion, se recomienda:

1. Conceder al app registration del bot permisos de aplicacion en Microsoft Graph para leer usuarios del tenant, por ejemplo `User.Read.All`, con admin consent.
2. Configurar `AZURE_TENANT_ID`.
3. Configurar `TEAMS_ALLOWED_TENANT_IDS=<tenant-id-corporativo>`.
4. Configurar `TEAMS_GRAPH_USER_LOOKUP=true`.
5. Reiniciar el bridge.

Con esto, cuando Teams envie un `AAD Object ID`, el bridge consultara Microsoft Graph para obtener `displayName`, `mail` y `userPrincipalName`. Luego usara ese correo/nombre para buscar el solicitante en ServiceDesk Plus, manteniendo el mismo control de ownership que la UI web.

### Error AADSTS700016

Si al escribir desde Teams aparece un error como:

```text
Application with identifier '<app-id>' was not found in the directory 'Bot Framework'
```

normalmente el bot fue creado como single-tenant, pero el bridge esta autenticando como multi-tenant. Configurar:

```env
MICROSOFT_APP_TYPE=SingleTenant
AZURE_TENANT_ID=<tenant-id-de-entra-id>
```

Luego reiniciar el bridge. Si el bot fue creado como multi-tenant, usar:

```env
MICROSOFT_APP_TYPE=MultiTenant
```

## Notas Pendientes

- Las sesiones son en memoria; para despliegue multiinstancia conviene moverlas a Redis o una tabla segura.
- `LDAP_REJECT_UNAUTHORIZED=false` solo debe usarse en laboratorio; produccion debe validar certificados.
