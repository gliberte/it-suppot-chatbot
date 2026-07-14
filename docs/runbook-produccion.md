# Runbook De Produccion Sophia

Este documento resume las pruebas y comandos operativos para Sophia en el servidor Linux de produccion.

## Contexto

- Proyecto principal: `/opt/sophia/it-support-chatbot`
- MCP ServiceDesk Plus/LDAP: `/opt/sophia/sdp-mcp-server`
- Backend Express: `localhost:3001`
- Proxy publico: Nginx en `443`
- Dominio: `sophia.barrazaycia.com`
- Endpoint Azure Bot:

```text
https://sophia.barrazaycia.com/api/teams/messages
```

## Estado Rapido

Diagnostico automatizado de solo lectura:

```bash
cd /opt/sophia/it-support-chatbot
npm run prod:check
```

Este comando revisa `sophia.service`, `nginx`, puerto `443`, health checks HTTP/HTTPS, variables principales de Teams y archivos de auditoria/runtime. No reinicia servicios ni modifica archivos.

Tambien resume actividad reciente:

- `Nginx Teams hits`: cuenta accesos recientes en Nginx a `/api/teams/messages` y `/api/teams/health`.
- `Teams audit reciente`: resume eventos recientes de `teams-audit.log`, incluyendo mensajes recibidos, respuestas enviadas y errores.

```bash
sudo systemctl status sophia --no-pager
sudo systemctl status nginx --no-pager
```

```bash
curl http://localhost:3001/api/teams/health
curl -k https://localhost/api/teams/health
```

Resultado esperado:

```json
{"success":true,"endpoint":"/api/teams/messages","configured":{...}}
```

## Validar Nginx Y HTTPS

```bash
sudo nginx -t
sudo ss -tulpn | grep -E ':80|:443'
```

Nginx debe escuchar en `0.0.0.0:443`.

Prueba local usando el host publico:

```bash
curl -k -v -H "Host: sophia.barrazaycia.com" https://127.0.0.1/api/teams/health
```

Si responde `200 OK`, Nginx, certificado y proxy local estan correctos.

Prueba local de ruteo del endpoint Teams:

```bash
curl -k -i -X POST https://localhost/api/teams/messages \
  -H "Content-Type: application/json" \
  -d '{}'
```

Sin una firma valida de Bot Framework, respuestas como `400`, `401` o `403` son aceptables. Lo importante es que no sea `404`, timeout o error de proxy; eso confirma que Nginx enruta `/api/teams/messages` hacia Express.

## Monitoreo Durante Pruebas De Teams

Abrir una sesion para Nginx:

```bash
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log
```

Abrir otra sesion para Sophia:

```bash
sudo journalctl -u sophia -f
```

Luego enviar en Teams:

```text
hola
```

Interpretacion:

- No aparece nada en Nginx: Azure Bot/FortiGate/NAT no esta llegando al servidor.
- Aparece en Nginx pero no en Sophia: revisar `proxy_pass` de Nginx hacia `localhost:3001`.
- Aparece en Sophia pero no responde: revisar errores Bot Framework, variables `.env`, Graph, SDP o MCP.

La misma lectura puede verse con:

```bash
npm run prod:check
```

Si `Nginx Teams hits` muestra `messages=0` despues de probar desde Teams, Azure Bot no esta llegando a Nginx. Si Nginx muestra hits pero `Teams audit reciente` no aumenta, revisar proxy/backend. Si ambos aumentan pero no hay respuesta en Teams, revisar errores del bridge o Bot Framework.

## Logs De Aplicacion

```bash
cd /opt/sophia/it-support-chatbot
ls -la *.log data/runtime-state.json
```

```bash
tail -n 80 audit.log
tail -n 80 teams-audit.log
tail -n 80 sdp-debug.log
```

Si `teams-audit.log` no existe y tampoco hay entradas en Nginx al escribir desde Teams, el trafico no esta llegando al backend.

## Persistencia Ligera

Sophia guarda sesiones, historial de Teams y acciones pendientes en:

```text
data/runtime-state.json
```

Permiso recomendado:

```bash
cd /opt/sophia/it-support-chatbot
chmod 600 data/runtime-state.json
```

Validar despues de reiniciar:

```bash
sudo systemctl restart sophia
sleep 2
npm run prod:check
curl -k https://localhost/api/teams/health
```

El check `runtime-state.json` muestra tamano, permisos, UID/GID, cantidad de sesiones, sesiones Teams, acciones pendientes e historial Teams sin imprimir el contenido sensible del archivo.

## Rotacion De Logs

Sophia escribe logs locales en `/opt/sophia/it-support-chatbot/*.log`. La politica versionada esta en:

```text
deploy/logrotate/sophia
```

Instalar o actualizar en el servidor:

```bash
cd /opt/sophia/it-support-chatbot
sudo cp deploy/logrotate/sophia /etc/logrotate.d/sophia
sudo chown root:root /etc/logrotate.d/sophia
sudo chmod 0644 /etc/logrotate.d/sophia
```

Validar sin ejecutar cambios:

```bash
sudo logrotate -d /etc/logrotate.d/sophia
```

Probar una rotacion forzada solo si se desea confirmar comportamiento:

```bash
sudo logrotate -f /etc/logrotate.d/sophia
```

La politica rota diariamente, conserva 14 archivos, comprime historicos y usa `copytruncate` para no requerir reinicio de Sophia. Incluye `su lsolano lsolano` porque el directorio del proyecto pertenece al usuario de despliegue; sin esa directiva logrotate puede rechazar la rotacion por permisos del directorio padre.

## Servicio Sophia

Reiniciar:

```bash
sudo systemctl restart sophia
sudo systemctl status sophia --no-pager
```

Ver ultimos errores:

```bash
sudo journalctl -u sophia -n 120 --no-pager
```

Ver definicion del servicio:

```bash
systemctl show sophia -p WorkingDirectory -p ExecStart
```

El `WorkingDirectory` debe ser:

```text
/opt/sophia/it-support-chatbot
```

## Backup Operativo

Antes de cambios relevantes de codigo o configuracion, crear un respaldo local:

```bash
cd /opt/sophia/it-support-chatbot
npm run prod:backup
```

Por defecto genera un archivo:

```text
/opt/sophia/backups/sophia-backup-YYYYMMDD-HHMMSS.tar.gz
```

El respaldo intenta incluir:

- `.env`
- `data/runtime-state.json`
- `teams/generated/soporte-it-teams.zip`
- logs locales si existen
- `/etc/systemd/system/sophia.service`
- configuracion Nginx `sophia`
- `/etc/logrotate.d/sophia`

El archivo puede contener secretos de produccion. Debe mantenerse con permisos `0600`, no debe subirse a git y solo debe compartirse por canales aprobados.

Para listar el contenido:

```bash
tar -tzf /opt/sophia/backups/sophia-backup-YYYYMMDD-HHMMSS.tar.gz
```

Para restaurar, extraer primero en un directorio temporal y copiar manualmente solo los archivos necesarios:

```bash
mkdir -p /tmp/sophia-restore
tar -xzf /opt/sophia/backups/sophia-backup-YYYYMMDD-HHMMSS.tar.gz -C /tmp/sophia-restore
```

## Version Y Rollback

Sophia usa versionado progresivo basado en `package.json` y `CHANGELOG.md`.

Regla recomendada:

- `PATCH` (`0.1.1`): correcciones pequeñas, prompts, formatos, ajustes de clasificación sin nueva capacidad grande.
- `MINOR` (`0.2.0`): nuevas capacidades visibles, playbooks, nuevas acciones, nuevos flujos de agente.
- `MAJOR` (`1.0.0`): cambios incompatibles, rediseño profundo de permisos, API, arquitectura o despliegue.

Antes de cada despliegue:

1. Actualizar `version` en `package.json` y `package-lock.json`.
2. Registrar la entrega en `CHANGELOG.md`.
3. Ejecutar validaciones locales.
4. Hacer commit y desplegar.

Antes y despues de cada despliegue, registrar version activa:

```bash
cd /opt/sophia/it-support-chatbot
npm run prod:version
```

El comando muestra rama, commit, fecha del commit, estado del working tree, estado de `sophia.service`, estado de `nginx` y ultimo backup disponible.

Antes de desplegar, guardar el commit bueno:

```bash
git rev-parse --short HEAD
```

Rollback de codigo a un commit conocido:

```bash
cd /opt/sophia/it-support-chatbot
git reset --hard <commit-bueno>
npm install
npm run build
sudo systemctl restart sophia
npm run prod:check
```

Restaurar `.env`, `runtime-state.json`, Nginx o systemd desde backup debe hacerse manualmente y solo copiando el archivo necesario desde un directorio temporal de restauracion.

## Checklist De Despliegue

Antes o despues de un despliegue, ejecutar:

```bash
cd /opt/sophia/it-support-chatbot
npm run prod:deploy-check
```

Este comando no ejecuta `git pull`, no crea backups, no reinicia servicios y no modifica configuracion. Valida version actual, sintaxis del backend, sintaxis de scripts operativos, build y `prod:check`.

Flujo manual recomendado para desplegar:

```bash
cd /opt/sophia/it-support-chatbot
npm run prod:version
npm run prod:backup
git pull
npm install
npm run build
sudo systemctl restart sophia
npm run prod:check
npm run prod:version
```

## Revision Segura De .env

Mostrar variables no secretas:

```bash
cd /opt/sophia/it-support-chatbot
grep -E '^(MICROSOFT_APP_ID|MICROSOFT_APP_TYPE|AZURE_TENANT_ID|PUBLIC_APP_DOMAIN|TEAMS_ALLOWED_TENANT_IDS|TEAMS_ALLOWED_CONVERSATION_IDS|TEAMS_DEV_TEST_TOKEN|TEAMS_GRAPH_USER_LOOKUP|TEAMS_USER_OVERRIDES|SUPPORT_ADMIN|MCI_ADMIN|RUNTIME_STATE_PATH)=' .env
```

Confirmar secretos sin imprimirlos:

```bash
grep -E '^(MICROSOFT_APP_PASSWORD|GEMINI_API_KEY|SDP_|LDAP_)=' .env | sed 's/=.*/=<configurado>/'
```

Valores esperados para Teams en produccion:

```env
MICROSOFT_APP_TYPE=SingleTenant
PUBLIC_APP_DOMAIN=sophia.barrazaycia.com
TEAMS_ALLOWED_CONVERSATION_IDS=
TEAMS_DEV_TEST_TOKEN=
TEAMS_GRAPH_USER_LOOKUP=true
TEAMS_ALLOWED_TENANT_IDS=<tenant-corporativo>
```

## Azure Bot

En Azure Portal, validar el recurso correcto comparando `MICROSOFT_APP_ID`.

Configuracion esperada:

```text
Messaging endpoint:
https://sophia.barrazaycia.com/api/teams/messages
```

Canal:

```text
Microsoft Teams habilitado
```

El paquete de Teams no necesita regenerarse si solo cambio el Messaging endpoint. El ZIP se actualiza solo si cambia el manifest, iconos, nombre, scopes, `botId`, version o dominios validos.

## Red / FortiGate

Para operacion normal de Teams se requiere:

```text
AzureBotService -> TCP 443 -> 192.170.1.61:443
```

El puerto `80` solo se requiere para emision o renovacion de certificado Let's Encrypt con HTTP-01:

```text
Internet temporal -> TCP 80 -> 192.170.1.61:80
```

Si red restringe por Service Tag, el tag principal solicitado es:

```text
AzureBotService
```

Si al enviar mensajes desde Teams no aparece ningun hit en Nginx, enviar a redes:

```text
Sophia responde correctamente localmente por HTTPS:
curl -k https://localhost/api/teams/health => 200 OK

Nginx esta escuchando en 443 y el certificado esta instalado, pero al enviar mensajes desde Teams no se registra ninguna entrada en Nginx ni en Sophia.

Favor validar policy/NAT de entrada TCP 443 desde AzureBotService hacia 192.170.1.61:443.
```

## Checklist De Corte A Produccion

1. `sudo systemctl status sophia --no-pager` esta activo.
2. `sudo systemctl status nginx --no-pager` esta activo.
3. `curl http://localhost:3001/api/teams/health` responde `200`.
4. `curl -k https://localhost/api/teams/health` responde `200`.
5. `sudo ss -tulpn | grep ':443'` muestra Nginx.
6. Azure Bot usa `https://sophia.barrazaycia.com/api/teams/messages`.
7. Canal Microsoft Teams esta habilitado en Azure Bot.
8. FortiGate permite `AzureBotService -> 192.170.1.61:443`.
9. En prueba Teams aparece entrada en Nginx.
10. En prueba Teams aparece evento en `journalctl -u sophia`.
11. Sophia responde `hola` en chat personal.
12. Sophia responde una consulta real: `Cual es el estado de mis tickets?`.

## Despliegue De Cambios

Actualizar codigo:

```bash
cd /opt/sophia/it-support-chatbot
git pull
npm install
npm run build
```

Actualizar MCP si hubo cambios:

```bash
cd /opt/sophia/sdp-mcp-server
git pull
npm install
npm run build
```

Reiniciar backend:

```bash
sudo systemctl restart sophia
sudo systemctl status sophia --no-pager
```

Validar:

```bash
curl http://localhost:3001/api/teams/health
curl -k https://localhost/api/teams/health
```
