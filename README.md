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
npm run teams:package # genera dist/teams/soporte-it-teams.zip
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

## Canal Microsoft Teams

El canal de Teams se implementa como un bot, no como incoming webhook. Los webhooks sirven para publicar mensajes en un canal, pero no son el mecanismo adecuado para una conversación bidireccional con confirmaciones, identidad de usuario y seguridad por ticket.

Endpoint del bot:

```text
POST https://<tu-dominio-publico>/api/teams/messages
```

Flujo recomendado:

1. Registrar un Azure Bot en el tenant corporativo.
2. Configurar el Messaging endpoint con `/api/teams/messages`.
3. Habilitar el canal Microsoft Teams en el recurso del bot.
4. Crear o actualizar el Teams app manifest con el `botId` igual a `MICROSOFT_APP_ID` y scopes `personal` y/o `team`.
5. Instalar la app en el equipo/canal dedicado de soporte IT.
6. Configurar variables de entorno y reiniciar el bridge.

Hay una plantilla base en `teams/manifest.template.json`. Para empaquetarla en Teams hay que reemplazar `${MICROSOFT_APP_ID}` y `${PUBLIC_APP_DOMAIN}`, agregar los iconos `color.png` y `outline.png`, y comprimir esos archivos en un `.zip` de app de Teams.

El proyecto incluye un generador simple que crea el manifest final, iconos PNG basicos y el zip instalable:

```bash
MICROSOFT_APP_ID="<app-id-del-bot>" PUBLIC_APP_DOMAIN="<dominio-publico-sin-https>" npm run teams:package
```

El paquete queda en:

```text
dist/teams/soporte-it-teams.zip
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
- `TEAMS_ALLOWED_CONVERSATION_IDS`: lista opcional separada por comas para limitar el bot a conversaciones/canales aprobados.
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

7. Subir `dist/teams/soporte-it-teams.zip` a Teams y escribir un mensaje al bot.

8. Si el usuario aun no esta mapeado, revisar:

```bash
tail -n 20 teams-audit.log
```

El log muestra `aadObjectId` y `conversationId`. Con `aadObjectId` se puede completar `TEAMS_USER_OVERRIDES`; con `conversationId` se puede cerrar `TEAMS_ALLOWED_CONVERSATION_IDS` para que el bot solo responda en el canal/chat aprobado.

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
3. Configurar `TEAMS_GRAPH_USER_LOOKUP=true`.
4. Reiniciar el bridge.

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
