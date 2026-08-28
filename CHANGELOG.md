# Changelog Sophia

Todas las mejoras relevantes de Sophia deben registrarse aquí antes de desplegar a producción.

Formato recomendado:
- `Added`: capacidades nuevas.
- `Changed`: cambios de comportamiento.
- `Fixed`: correcciones.
- `Security`: controles de seguridad, permisos o auditoría.
- `Ops`: cambios de despliegue, monitoreo o operación.

## [0.54.19] - 2026-08-27

### Security
- **`sdp_assign_request` permitía que el solicitante de un ticket lo reasignara a cualquier técnico (`server.js`):** detectado al revisar el fix anterior antes de que llegara más lejos -- a diferencia de `sdp_add_note`/`sdp_update_request`/`sdp_resolve_request` (donde tiene sentido que el solicitante o el técnico asignado tengan voz), a quién se le asigna un ticket es una decisión de despacho/triage. `assertToolAllowedForUser` caía en el chequeo genérico (`isRequester || isTechnician`), así que cualquier empleado podía pedirle a Sophia que reasignara su propio ticket al técnico que quisiera.
  - **Corregido** restringiendo `sdp_assign_request` a solo administradores/ejecutivos IT, con su propio mensaje de error. Se actualizó también el catálogo del prompt para que Sophia no lo intente con un usuario normal.
  - **Verificado con el arnés de evaluación** (`npm run eval:agent`): caso nuevo confirmando que un usuario normal NO dispara `sdp_assign_request`, más el caso existente confirmando que un admin sí puede -- 24/24 contra Gemini real. `npm test` 177/177.

## [0.54.18] - 2026-08-27

### Fixed
- **Sophia no sabía que podía reasignar un ticket a otro técnico (`agent-orchestrator.js`):** tercer caso del mismo hueco (`sdp_update_request`, `sdp_resolve_request`, y ahora `sdp_assign_request`) -- el backend ya autorizaba la acción, pero nunca apareció en el catálogo de la IA. Encontrado proactivamente al auditar todas las herramientas SDP del MCP server contra el catálogo del prompt, tras el lanzamiento público de Sophia.
  - **Corregido** agregando la entrada 13 al catálogo: `technician_name` con el nombre exacto del técnico.
  - **Bug relacionado encontrado y corregido en `sdp-mcp-server`:** `sdp_assign_request` solo actualizaba el campo nativo `technician` de SDP, pero el resto del código de Sophia (`getAssignedTechnicianValue`, carga por técnico del reporte ejecutivo, tarjeta de detalle) usa el campo personalizado `udf_pick_2701` ("Técnico asignado") como fuente de verdad. Sin corregirlo, reasignar un ticket habría dejado los dos campos desincronizados -- ahora se actualizan ambos en la misma llamada.
  - **Verificado con el arnés de evaluación** (`npm run eval:agent`): nuevo caso de reasignación, 23/23 contra Gemini real (sin regresiones). `npm test` 177/177.

## [0.54.17] - 2026-08-27

### Fixed
- **Sophia no sabía que podía agregar la resolución de un ticket (`agent-orchestrator.js`):** mismo hueco que ya se había corregido antes para `sdp_update_request` -- el backend ya autorizaba `sdp_resolve_request` (solicitante, técnico asignado o admin) y ya llama a `POST /requests/{id}/resolutions` en SDP, pero la herramienta nunca apareció en el catálogo que lee la IA, así que Sophia nunca la elegía cuando un técnico pedía "agrega esta resolución al ticket...".
  - **Corregido** agregando la entrada 12 al catálogo: `resolution_text` con el texto de la solución, aclarando que esta llamada NO cambia el estado del ticket (eso sigue siendo una acción aparte con `sdp_update_request`, para no asumir de más).
  - **Verificado con el arnés de evaluación** (`npm run eval:agent`): nuevo caso con un mensaje real ("Agrega esta resolución al ticket..."), 22/22 contra Gemini real (sin regresiones en los 21 casos existentes). `npm test` 177/177.

## [0.54.16] - 2026-08-27

### Fixed
- **HOTFIX: pedir cambiar el estado de un ticket Y dejar un comentario en un solo mensaje se enrutaba solo a `sdp_add_note`, perdiendo el cambio de estado (`agent-orchestrator.js`):** detectado en producción -- Eliseo pidió "colócalo en espera y coméntale que...", Sophia solo agregó la nota (por la palabra "comentario" en las instrucciones de `sdp_add_note`) y nunca cambió el estado; tuvo que preguntarle después "¿y lo cambiaste de estado?" para que Sophia lo hiciera aparte.
  - **Corregido** aclarando en el catálogo (herramientas 5 y 11) y en la regla de oro correspondiente que, si el mensaje pide cambiar el estado Y da una justificación/comentario para ese cambio, es **una sola acción** `sdp_update_request` con `tool_args.comments`, nunca `sdp_add_note` ni dos acciones separadas.
  - **Verificado con el arnés de evaluación** (`npm run eval:agent`): nuevo caso con el mensaje real de producción, 21/21 contra Gemini real (sin regresiones en los 20 casos existentes).

## [0.54.15] - 2026-08-27

### Added
- **Sophia ahora registra localmente el comentario obligatorio de los cambios de estado que ella misma hace (`server.js`):** se investigó a fondo (ver `docs/runbook-produccion.md`) y se confirmó que ServiceDesk Plus **no expone ese comentario por ningún endpoint de su API REST v3** (se descartaron `/history`, `/history/{id}`, el objeto base del ticket, `/notes` y `/conversations`), aunque sí se ve en el portal web. Como Sophia sí conoce el comentario que ella misma envía al cambiar un estado, ahora lo guarda en `data/status_change_comments.json` (ignorado por git) y lo muestra en la tarjeta de detalle del ticket cuando el estado actual coincide con el que registró.
  - **Limitación honesta:** solo funciona para cambios hechos *a través de Sophia*. Un cambio de estado hecho directamente en el portal de SDP sigue sin poder mostrarse, porque Sophia nunca se entera de ese comentario.

Verificado con `npm test` (177/177, sin regresiones).

## [0.54.14] - 2026-08-27

### Fixed
- **Corrección al registro anterior (v0.54.13): el piso mínimo de `safeProgressBarValue()` NO resolvió el `ProgressBar` indeterminado con valor cero.** Probado en producción real después del hotfix: las barras con valor 0 (ej. un técnico sin tickets abiertos) siguen mostrándose animadas/indeterminadas en Teams, incluso con el piso mínimo de `0.01` en vez de `0`. Se decidió aceptarlo como detalle cosmético menor en vez de seguir investigando -- ver `docs/runbook-produccion.md`, sección "Barras De Progreso En Adaptive Cards". El código de `safeProgressBarValue()` se deja tal cual (no hace daño), pero no se debe asumir que resuelve este problema.

## [0.54.13] - 2026-08-27

### Fixed
- **HOTFIX: un `ProgressBar` con `value: 0` se renderiza animado/indeterminado en Teams, no como barra vacía (`server.js`):** detectado en producción -- la barra de un técnico sin tickets abiertos aparecía "cargando" en vez de vacía, mientras el resto (con valores > 0) se veían fijas. `safeProgressBarValue()` manda un piso mínimo positivo (`0.01`) cuando el valor real es `0`, `NaN` o `undefined`, para forzar que Teams siempre lo trate como determinado. Aplica a las tres barras del reporte ejecutivo (técnicos, categorías, MCI).

## [0.54.12] - 2026-08-27

### Changed
- **Rediseño del "reporte ejecutivo IT" con barras reales en vez de texto plano/FactSet (`server.js`):** "Carga por personal técnico", "Categorías con Mayor Volumen de Incidentes" y "Avance de MCI" ahora usan el elemento nativo `ProgressBar` (barra proporcional coloreada) en vez de listas de texto con `-` o un `FactSet`. Requirió subir el schema del card de `1.4` a `1.6` (`ProgressBar` no existe en 1.4). Documentado el hallazgo -- y dos técnicas que NO funcionan (`Image` con `width:"stretch"`, `Container` vacío con `style`) -- en `docs/runbook-produccion.md`. Verificado con una tarjeta de prueba real enviada a Teams (no solo en el Adaptive Card Designer).
- **El bloque "Carga por personal técnico" ahora se muestra siempre**, incluso para el perfil ejecutivo (Yariela / Gerente IT) -- antes estaba oculto por defecto para ese perfil. Con el nuevo diseño en barras se consideró suficientemente digerible para mostrarlo sin pedirlo explícitamente, así que se eliminó la frase de activación "detalle/desglose por técnico" agregada en la versión anterior (ya no hace falta).

Verificado con `npm test` (177/177, sin regresiones).

## [0.54.11] - 2026-08-27

### Ops
- **Endpoint temporal de diagnóstico `POST /api/admin/test-card/send` (`server.js`):** envía un Adaptive Card arbitrario (recibido en el body) a un usuario ya conocido de Teams (`email`), reutilizando `teamsConversationReferences` y `sendTeamsReply`. Se agregó para validar en Teams real si elementos de schema nuevos (`ProgressBar`, schema 1.6) que sí renderizan en el Adaptive Card Designer también renderizan en el host real de Teams, antes de usarlos en el rediseño del informe ejecutivo. Candidato a eliminar una vez resuelta esa validación.

## [0.54.10] - 2026-08-27

### Added
- **Frase para desbloquear el desglose por técnico en el perfil ejecutivo (`server.js`):** el perfil "Gerente de IT" (Yariela Saucedo de Vallarino, `getExecutiveItProfile`) siempre tuvo oculta la sección "Carga por personal técnico" del reporte ejecutivo, sin ninguna forma de solicitarla. Ahora, si el mensaje incluye "detalle por técnico" o "desglose por técnico" (ej. *"reporte ejecutivo con detalle por técnico"*), `createExecutiveItReportCard`/`formatExecutiveItReportText` muestran esa sección igual que a un administrador operativo, sin afectar el comportamiento por defecto (sigue oculta si no se pide explícitamente).

## [0.54.9] - 2026-08-27

### Fixed
- **El campo `recipients` del informe ejecutivo semanal no coincidía con quién realmente lo recibía (`server.js`):** al probar en producción (v0.54.8) se observó un correo duplicado (`luis.solano@bacosa.com` dos veces) en `recipients`. Causa real: ese campo se armaba leyendo solo `IT_EXECUTIVE_EMAILS` (o `SUPPORT_ADMIN_EMAILS` como respaldo si la primera no estaba configurada), sin deduplicar, mientras que el envío real por Teams ya usaba la unión de ambas variables (`SUPPORT_ADMIN_EMAILS` ∪ `IT_EXECUTIVE_EMAILS`) más los AAD Object IDs de `TEAMS_ADMIN_AAD_OBJECT_IDS`. Corregido para que `recipients` refleje exactamente la misma unión deduplicada que usa el envío, así el historial (`data/weekly_reports_history.json`) y la respuesta del endpoint quedan consistentes con la entrega real.
- **Ver también v0.54.8** más abajo: mismo commit de trabajo, corrige que el informe ejecutivo semanal enviaba métricas y un adjunto PDF falsos.

## [0.54.8] - 2026-08-27

### Fixed
- **El informe ejecutivo semanal enviaba métricas y un adjunto falsos (`server.js`):** al programarlo por cron se detectó que las 5 métricas (`ticketsProcessed`, `slaCompliance`, `csatAvg`, `mciCount`, `kbaCreated`) estaban hardcodeadas -- siempre los mismos 5 valores fijos cada semana -- y la tarjeta afirmaba que había "un archivo PDF adjunto" que nunca existió ni se generaba en ningún lugar del código.
  - **Corregido con `computeWeeklyExecutiveMetrics()`:** calcula las 3 métricas para las que sí hay datos reales -- tickets resueltos/cerrados en los últimos 7 días y su cumplimiento de SLA (comparando `due_by_time` contra la última actualización) vía `sdp_list_requests`, incidentes mayores (MCI) resueltos en la ventana vía `mci_only: true`, y artículos KBA aprobados en la ventana desde `data/knowledge-candidates.json`.
  - **CSAT también ahora es real:** se recuperan las notas de cada ticket resuelto (`sdp_get_request_details`) y se promedian las calificaciones registradas por la encuesta ⭐ `[Encuesta CSAT]` que Sophia ya guarda como nota del ticket (mismo patrón que el "reporte ejecutivo" conversacional existente).
  - **Sin inventar números:** si una métrica no tiene datos suficientes (ej. ningún ticket con `due_by_time`, o cero calificaciones CSAT) la tarjeta muestra "No disponible" en vez de un valor falso; cualquier error al consultar SDP queda visible como advertencia en la propia tarjeta.
  - **Se quitó la mención al PDF adjunto**, reemplazada por una nota aclarando que las métricas se calculan sobre los últimos 7 días de actividad real.
  - Verificado con `npm test` (177/177, sin regresiones).

## [0.54.7] - 2026-08-27

### Ops
- **Resumen ejecutivo semanal ahora se documenta como job de cron (`docs/runbook-produccion.md`):** `npm run prod:weekly-report` ya existía como script standalone (mismo patrón que `prod:daily-report` y `prod:broadcast`: hace `POST` a `/api/admin/weekly-report` sobre la instancia local), pero no estaba en el runbook ni programado -- solo se disparaba a mano. Se agregó la sección "Resumen Ejecutivo Semanal" con el cron recomendado (lunes 7:00 a.m.) y una nota explícita de que `sendWeeklyExecutiveReportToExecutives` no tiene guarda de "ya se envió esta semana" (cada corrida genera y envía un reporte nuevo), para no disparar el cron más de una vez por semana.

## [0.54.6] - 2026-08-25

### Fixed
- **Sophia ahora sabe que puede cambiar el estado de un ticket (`agent-orchestrator.js`):**
  - **Causa real:** el backend ya autorizaba al solicitante, al técnico asignado (por el campo Técnico asignado) o a un administrador a modificar un ticket vía `sdp_update_request` (`assertToolAllowedForUser` ya validaba `isRequester || isTechnician`), pero esa herramienta nunca apareció en el catálogo del prompt -- solo se mencionaba para decirle a Sophia que NO la usara para seguimientos ni para MCI. La IA nunca la elegía porque no sabía que existía para su propósito real.
  - **Corregido** agregando la entrada 11 al catálogo: cambiar estado/prioridad de un ticket vía `tool_args.status`/`tool_args.priority`, aclarando quién puede pedirlo (solicitante, técnico asignado o admin) y remitiendo a `sdp_add_note`/`sdp_update_mci` para sus casos ya cubiertos.
  - **Verificado con el arnés de evaluación** (`npm run eval:agent`): nuevo caso "Técnico asignado pide cambiar el estado de su ticket" en 3/3 contra Gemini real, y las 20 pruebas existentes siguen en verde (sin regresiones).

## [0.54.5] - 2026-08-25

### Added
- **🔔 Sophia ahora te avisa cuando tu ticket cambia:** si alguien agrega un seguimiento a tu solicitud o cambia su estado, te llega un mensaje privado de Sophia contándote qué pasó -- ya no tienes que estar revisando manualmente. Solo te llega a ti, nunca a un canal ni a otros compañeros, y solo si le has escrito a Sophia en Teams alguna vez.
- **🎂 Sophia puede recordar tu cumpleaños:** solo dile la fecha por chat (ej. "mi cumpleaños es el 15 de marzo") y ese día te va a felicitar en privado. Guarda únicamente el día y el mes, nunca el año, y puedes pedirle que lo borre cuando quieras.
- **🆕 El equipo de soporte se entera de tickets nuevos más rápido:** ahora reciben un aviso apenas se crea una solicitud, así que puedes esperar una atención más ágil.

## [0.54.4] - 2026-08-25

### Added
- **🆕 Aviso de tickets nuevos al personal técnico IT (`lib/new-ticket-alerts.js`, `server.js`):**
  - **Mismo modelo de sondeo que el aviso de seguimientos** (no hay webhook de ServiceDesk Plus disponible): cada `SOPHIA_NEW_TICKET_ALERTS_POLL_MINUTES` (default 10) revisa si hay tickets con `created_time` posterior a la última línea base guardada (`data/new_ticket_alerts_state.json`, ignorado por git).
  - **Lista de destinatarios propia:** `IT_TECHNICAL_STAFF_EMAILS`, separada de `SUPPORT_ADMIN_EMAILS` -- decisión explícita para no mezclar "administradores de soporte" con "personal técnico a avisar de tickets nuevos".
  - **Sin ruido en el primer sondeo:** la primera corrida solo establece línea base, nunca avisa de tickets que ya existían antes de activar esto.
  - **Endpoint manual `POST /api/admin/new-ticket-alerts/trigger`** para probar sin esperar al intervalo.
  - **6 pruebas unitarias** en `lib/__tests__/new-ticket-alerts.test.js` y **3 pruebas de integración** (aviso real, primer sondeo sin avisar, sin destinatario con Teams guardado). 177 tests en total con `npm test`.

## [0.54.3] - 2026-08-25

### Fixed
- **HOTFIX: el sondeo de seguimientos de tickets (v0.54.2) nunca encontraba a nadie a quién avisar (`server.js`):**
  - **Causa real:** `sdp_list_requests` sin `fields_required` explícito no incluye el objeto `requester` en la respuesta de ServiceDesk Plus -- se confirmó contra una respuesta real capturada en `sdp-mcp-server/ticket_history.json`, donde un ticket típico solo trae `created_time`/`request_type`/`subject`/`technician`/`id`/`category`/`subcategory`/`status`, sin `requester`. Como el sondeo necesita el email del solicitante para saber a quién avisar, todos los tickets se descartaban antes de siquiera revisar si tenían conversación de Teams guardada -- por eso la primera corrida en producción dejó `data/ticket_followup_state.json` completamente vacío pese a haber 28 conversaciones de Teams guardadas y decenas de tickets abiertos.
  - **Corregido** pasando `fields_required: ['subject', 'status', 'requester', 'last_updated_time']` explícito en esa consulta.

## [0.54.2] - 2026-08-21

### Added
- **🔔 Aviso privado de seguimientos de tickets (`lib/ticket-followups.js`, `server.js`):**
  - **Sondeo, no webhook:** se verificó directamente en `sdp-mcp-server` que ServiceDesk Plus no tiene ningún mecanismo de push disponible en esta integración (cero coincidencias de "webhook"/"notification"/"subscribe" en su código), así que Sophia sondea tickets abiertos cada `SOPHIA_TICKET_FOLLOWUP_POLL_MINUTES` (default 10) comparando `last_updated_time` contra el último valor visto por ticket.
  - **Solo al dueño del ticket, en privado por Teams:** si el ticket cambió, consulta sus notas y avisa con el texto del seguimiento nuevo (o, si el cambio fue de estado sin nota nueva, un aviso genérico). Nunca a otros ni a un canal.
  - **Sin ruido en el primer sondeo:** un ticket nunca visto antes solo establece línea base -- no dispara un aviso por algo que pudo haber pasado antes de que Sophia empezara a vigilarlo.
  - **Endpoint manual `POST /api/admin/ticket-followups/trigger`** para probar sin esperar al intervalo, siguiendo el mismo patrón que `/api/admin/reminders/trigger`.
  - **12 pruebas unitarias** en `lib/__tests__/ticket-followups.test.js` y **3 pruebas de integración** que cubren el ciclo completo (HTTP → sondeo → notas → envío mockeado a Teams), incluyendo que no avisa sin conversación de Teams guardada ni la primera vez que ve un ticket. 168 tests en total con `npm test`.
  - `server.js` ahora también exporta `teamsConversationReferences` y los tests mockean `botbuilder` -- necesario para poder probar el envío privado a Teams sin depender de credenciales reales de Bot Framework.

## [0.54.1] - 2026-08-18

### Added
- **🎂 Registro voluntario de cumpleaños y saludo privado (`lib/birthdays.js`, `server.js`):**
  - **Opt-in por chat:** un usuario le dice su cumpleaños a Sophia (ej. "mi cumpleaños es el 15 de marzo") y ella lo guarda en `data/birthdays.json` (ignorado por git). Puede pedir que lo borre en cualquier momento ("borra mi cumpleaños").
  - **Solo mes y día, nunca el año de nacimiento** -- no hace falta para felicitar a alguien y expondría la edad exacta.
  - **Saludo privado, no público:** un cron diario (8:00 a.m. hora Panamá, controlable con `SOPHIA_BIRTHDAY_GREETINGS_ENABLED`) revisa cumpleaños del día y le manda a esa persona, y solo a esa persona, un mensaje de Teams. No avisa a compañeros ni a ningún canal -- eso queda pendiente de definir a quién se le puede avisar y cómo pedir consentimiento para eso.
  - **20 pruebas unitarias** en `lib/__tests__/birthdays.test.js` (parseo de fechas en español, validación de mes/día, lógica de "ya se saludó este año") y **2 pruebas de integración** que confirman que el registro/borrado intercepta el mensaje antes de llegar a `AgentOrchestrator` (153 tests en total con `npm test`).

## [0.54.0] - 2026-08-18

### Added
- **🧠 Sophia piensa con un modelo de IA más nuevo:** Actualizamos el motor de razonamiento a Gemini 3.7 Flash, la generación más reciente disponible. Las respuestas y decisiones de Sophia deberían sentirse más precisas y rápidas.
- **🔍 Mejor comprensión de preguntas mal formuladas:** Si preguntas algo de forma más informal o imprecisa (ej. "wifi mal", "correo raro no llega"), Sophia ahora tiene más probabilidad de encontrar la guía correcta en vez de quedarse sin respuesta.
- **📢 Este aviso de novedades ahora llega a todos:** Antes solo se lo enviábamos al equipo de soporte IT; a partir de ahora, cualquiera que haya chateado con Sophia en Teams recibe las actualizaciones relevantes.

### Security
- **🔒 Control de acceso a tickets reforzado:** Corregimos un caso donde, bajo cierta configuración, un usuario podía llegar a ver información de tickets que no le pertenecían. Ya no es posible.

### Ops
- **🛠️ Más pruebas automáticas y un despliegue más confiable:** Ampliamos la cobertura de pruebas de Sophia (131 pruebas automáticas nuevas) y resolvimos varios problemas de despliegue, para que las actualizaciones futuras lleguen más rápido y con menos riesgo de interrupciones.

## [0.53.10] - 2026-08-18

### Fixed
- **Causa real del conflicto recurrente de `package-lock.json` (`package-lock.json`, `docs/runbook-produccion.md`):**
  - **No era la plataforma, era la metadata de versión desincronizada:** `package-lock.json` guarda una copia del campo `version` de `package.json`. Durante v0.52.3–v0.53.9 se subió el `version` de `package.json` en cada commit sin correr `npm install` localmente para sincronizar esa copia en el lockfile, así que quedó fijo en `0.53.6` mientras `package.json` avanzaba. Cualquier `npm ci`/`npm install` en el servidor detectaba el desfase y lo "corregía", generando el diff que bloqueó `git pull` tres veces seguidas en esta serie de despliegues -- incluso después de cambiar a `npm ci`.
  - **Corregido corriendo `npm install` local** (sincroniza el lockfile a `0.53.10`) y documentada la regla en el runbook: después de cambiar `version` en `package.json`, correr `npm install` y comitear el `package-lock.json` resultante en el mismo commit.

## [0.53.9] - 2026-08-18

### Ops
- **Arreglar de raíz el problema recurrente de `package-lock.json` bloqueando `git pull` en el servidor (`docs/runbook-produccion.md`):**
  - **`npm ci` en vez de `npm install`** en los flujos de deploy y rollback: instala exactamente lo que dice `package-lock.json` y nunca lo modifica, eliminando la causa del conflicto (diferencia de versión de Node/npm entre el servidor y donde se generó el lockfile) en vez de seguir descartando el archivo manualmente en cada despliegue. Se validó localmente que `npm ci` funciona con el lockfile actual antes de documentarlo.
- **Dejar de versionar los `data/*.json` que Sophia escribe en producción (`.gitignore`):** 14 archivos de historial/estado runtime (`major_incidents.json`, `network_diagnostics_history.json`, `teams-conversation-references.json`, `active_ad_mock.json` y otros — todos con el mismo patrón de lectura/escritura atómica vía tmp+rename que ya tenían `runtime-state.json`/`active-situations.json`, pero que por descuido nunca se agregaron a `.gitignore`) quedaron sin trackear con `git rm --cached` (conserva el contenido en disco, solo saca el archivo del índice de git). Sin este cambio, cualquier commit futuro que tocara uno de esos archivos iba a bloquear `git pull` en el servidor exactamente como pasó con `package-lock.json`. También se agregaron a `.gitignore` los logs rotados por logrotate (`*.log.*`), los respaldos de `.env` (`.env.backup-*`) y los borradores de conocimiento exportados/pulidos, que aparecían como "sin trackear" en el servidor sin necesidad.
  - **Nota para el próximo `git pull` en el servidor:** si aparece un conflicto por estos archivos, usar `git rm --cached <archivo>` (nunca sin `--cached`, ni `git reset --hard`) para no borrar el historial acumulado en producción.

## [0.53.8] - 2026-08-17

### Ops
- **Aviso de `package-lock.json` en el flujo de despliegue (`docs/runbook-produccion.md`):**
  - **`git status --short` antes de `git pull`** en "Checklist De Despliegue" y "Despliegue De Cambios", para detectar a tiempo cuando `npm install` se corrió en el servidor sin `pull` previo y dejó `package-lock.json` con cambios locales que bloquean el pull (`error: Your local changes... would be overwritten by merge`). Se documenta el fix (`git diff package-lock.json` para confirmar que es solo ruido, luego `git checkout -- package-lock.json`) en el mismo lugar, ya que ocurrió dos veces seguidas en esta serie de despliegues.

## [0.53.7] - 2026-08-17

### Added
- **Tests de integración de rutas Express (`test/integration/`, `vitest.config.js`):**
  - **`server.js` ahora exporta `app`** y solo omite el auto-arranque (`app.listen`, `initMCP`, conexión MCP real) cuando `NODE_ENV=test` (Vitest lo fija automáticamente); en producción (PM2 fija `NODE_ENV=production`) y en uso normal el comportamiento es idéntico al de antes.
  - **`test/integration/setup.js` mockea toda la infraestructura externa:** el cliente MCP (`@modelcontextprotocol/sdk`), `AgentOrchestrator.processMessage`, `@google/generative-ai` y `fs/promises` (para no escribir en `audit.log`/`teams-audit.log` reales en cada corrida de tests).
  - **14 tests con `supertest`** en `test/integration/routes.test.js`: `POST /api/login` (éxito y credenciales inválidas), `requireAuth` en `GET /api/me`, ownership en `POST /api/get-ticket-status` (403/200), scoping por `requester_id` en `POST /api/list-requests` para usuario normal vs. admin, confirmación explícita en `POST /api/create-ticket` (incluye que el `requester_id` de la sesión no pueda ser suplantado por el body del cliente), y el ciclo completo `POST /api/chat` → evento SSE `confirmation_required` → `POST /api/confirm-action` → ejecución real de la herramienta mockeada.
  - **131 tests en total con `npm test`** (117 unitarios + 14 de integración). No cubre `/api/teams/messages` (requiere validar token real de Bot Framework) ni los clusters grandes de `server.js` que siguen sin extraer.

## [0.53.6] - 2026-08-17

### Ops
- **Tercer y último corte de `lib/redaction.js` por ahora (`server.js`):**
  - **2 funciones puras más:** `createAdaptiveCardPreview` y `createAdaptiveCardAuditSignals` — extraen texto de `TextBlock` de tarjetas adaptativas de Teams para preview de auditoría y señales de contenido (seguimientos/historial/correo/nota). Sin cambios de comportamiento.
  - **5 pruebas nuevas** (116 en total con `npm test`). `server.js` baja de 12,160 a 12,122 líneas.
  - **Se detiene aquí el despiece de `server.js` por esta sesión:** los clusters restantes (bot de Teams ~62 funciones, lógica de tickets ~100+) están profundamente acoplados a estado compartido (`sessions`, `mcpClient`) y no tienen tests de integración de rutas Express/Teams. Extraerlos con la misma confianza requeriría primero esa cobertura.

## [0.53.5] - 2026-08-17

### Ops
- **Ampliar `lib/redaction.js` con el cluster de "referencia sanitizada de conocimiento" (`server.js`):**
  - **6 funciones puras más movidas:** `createSanitizedKnowledgeResponse`, `isResolvedKnowledgeStatus`, `cleanKnowledgeText`, `redactKnowledgePeople`, `escapeRegExp`, `getResolutionText` — la lógica que arma una versión sanitizada de un ticket ajeno (resuelto/cerrado) como referencia de conocimiento cuando el ownership check no permite mostrar el detalle completo.
  - **La verificación esta vez encontró dos hallazgos reales antes de comitear:** (1) `escapeRegExp` sí se usa fuera del cluster (línea ~3883) y casi queda sin importar por segunda vez — el comentario que dejé listando nombres había generado además falsos positivos en el propio chequeo, así que ahora se excluyen líneas de comentario antes de comparar; (2) el chequeo detectó que 6 imports del corte anterior (v0.53.4) — `minimizePerson`, `minimizeRequest`, `minimizeValue`, `extractJsonFromErrorMessage`, `summarizeAuditUdfValue`, `summarizeAuditUdfFields` — nunca se llamaban directamente desde `server.js` (solo entre sí, dentro de `lib/redaction.js`), así que se quitaron del import por innecesarios.
  - **16 pruebas nuevas** en `lib/__tests__/redaction.test.js` (111 en total con `npm test`). `server.js` baja de 12,250 a 12,160 líneas.

## [0.53.4] - 2026-08-17

### Ops
- **Extracción de `lib/redaction.js` desde `server.js` (corte pequeño y seguro tras el incidente de `getMciLeaderValue`):**
  - **14 funciones puras de minimización/redacción movidas:** `truncateText`, `stripHtml`, `redactSensitiveText`, `getEmailDomain`, `minimizePerson`, `minimizeRequest`, `minimizeValue`, `minimizeToolOutputForGemini`, `minimizeAuditError`, `extractJsonFromErrorMessage`, `minimizeAuditArgs`, `summarizeAuditUdfFields`, `summarizeAuditUdfValue` y `createAuditTextPreview` — exactamente la maquinaria detrás de la sección "Minimización Para Gemini Cloud" del README. Sin cambios de comportamiento; cada función se importa de vuelta con el mismo nombre.
  - **Verificación reforzada:** antes de dar la extracción por buena se comparó, para cada símbolo exportado de los tres módulos en `lib/` (`authz.js`, `pending-actions.js`, `redaction.js`), su uso real en `server.js` contra la lista de imports (sin asumir que toda referencia es una llamada con paréntesis, que fue justo lo que causó el bug de `getMciLeaderValue` en v0.52.3).
  - **37 pruebas nuevas** en `lib/__tests__/redaction.test.js` (95 en total con `npm test`). `server.js` baja de 12,467 a 12,250 líneas.

## [0.53.3] - 2026-08-17

### Ops
- **Automatizar generación y aviso de candidatos de conocimiento (`scripts/prod-daily-report.js`, `docs/runbook-produccion.md`):**
  - **Cron nuevo antes del reporte diario:** `npm run knowledge:candidates` corre a las 7:00 a.m. (30 min antes del reporte de las 7:30) para detectar candidatos nuevos desde `audit.log` sin depender de que alguien se acuerde de correrlo a mano. Es aditivo e idempotente, nunca aprueba ni aplica nada automáticamente.
  - **Nueva sección "Candidatos De Conocimiento" en el reporte diario:** cuenta nuevos del día, pendientes de revisión y aprobados sin aplicar, lista los pendientes (ID/tipo/título) y sugiere `npm run knowledge:review` cuando hay algo que revisar. La revisión, aprobación y aplicación al `knowledge/` siguen siendo decisiones humanas manuales.

## [0.53.2] - 2026-08-17

### Changed
- **Fallback de umbral en la recuperación RAG (`rag.js`):**
  - **Segundo intento con umbral más permisivo:** `searchKnowledge` ahora reintenta con `RAG_FALLBACK_MIN_SCORE` (default `0.5`) cuando `RAG_MIN_SCORE` (default `0.68`) no devuelve ningún fragmento, en vez de dejar a Sophia sin `retrieved_knowledge`. `npm run rag:test` mostró varios casos ya en producción raspando el umbral principal (scores entre 0.673 y 0.692); probar reformulaciones más torpes de las mismas 18 consultas confirmó el problema real: 2 de 6 (`"correo raro no llega"`, `"wifi mal"`) devolvían cero resultados antes del cambio y recuperan el playbook correcto después. Solo aplica cuando la llamada no fija su propio `minScore` más bajo, así que no afecta la clasificación de tickets (`RAG_CLASSIFY_MIN_SCORE=0.3`).

## [0.53.1] - 2026-08-17

### Added
- **Arnés de evaluación del agente (`scripts/eval-agent.js`, `npm run eval:agent`):**
  - **19 casos contra Gemini real:** cubren saludo/charla general, listar tickets y MCI propios, MCI por líder (incluida la aclaración obligatoria cuando un admin pide tickets "de" alguien sin precisar solicitante/técnico), las dos fases de creación de ticket, automatizaciones (desbloqueo de cuenta), `sdp_add_note` con ID/texto explícitos y por memoria del último ticket, preguntas de marca/empresa vía RAG, gráficos, actualización de MCI, `sap_hana_query` y `web_search_support` (incluyendo que NO se use para sistemas propios como Barraza Móvil).
  - **Flags `--only` y `--repeat`:** para aislar un caso o repetirlo varias veces y medir consistencia, dado que el modelo no es determinístico.
  - **Hallazgo real de la primera corrida:** el eval detectó que `sap_hana_query` podía devolver el SQL bajo la clave `sql_query` en vez de `query`/`sqlQuery`/`sql`, las únicas que `callMcpTool` reconocía — la consulta se habría ejecutado vacía en producción. Se agregó `sql_query` como alias reconocido en `server.js` y se hizo explícito en el `SYSTEM_PROMPT` que el argumento correcto es `tool_args.query`, para reducir la ambigüedad que originó la variante.

### Changed
- **Actualización del modelo de razonamiento a Gemini 3.7 Flash (`.env`, `.env.example`):**
  - **Modelo principal:** `GEMINI_DECISION_MODEL` y `GEMINI_SUMMARY_MODEL` pasan de `gemini-2.5-flash` a `gemini-3.7-flash` para la decisión del agente (`agent-orchestrator.js`) y el resumen/formateo de resultados de SDP/SAP (`server.js`). Se validó contra la API real que el modelo soporta `systemInstruction` y `responseMimeType: application/json`, y pasó las 19 pruebas del arnés de evaluación.
  - **Fallback más cercano:** `GEMINI_FALLBACK_MODEL` pasa de `gemini-2.0-flash` a `gemini-2.5-flash` (el modelo estable anterior), para que si `gemini-3.7-flash` falla, Sophia caiga a un modelo probado en vez de saltar dos generaciones atrás.

## [0.53.0] - 2026-08-17

### Fixed
- **HOTFIX: `getMciLeaderValue is not defined` al listar/buscar MCI por Líder (`server.js`):**
  - **Regresión de la extracción v0.52.3:** Al mover las funciones de ownership a `lib/authz.js`, `getMciLeaderValue` quedó fuera de la lista de símbolos importados de vuelta en `server.js` porque la única referencia restante la pasaba por nombre de función (`getValue: getMciLeaderValue` en `getAccentInsensitivePersonSearch`) en vez de invocarla, y la verificación previa solo buscaba usos con paréntesis (`getMciLeaderValue(`). Esto rompía en producción cualquier búsqueda de MCI por Líder que cayera en el reintento sin sensibilidad a acentos, con `[Bridge] Error crítico ejecutando herramienta sdp_list_requests: getMciLeaderValue is not defined`. Se agregó el import faltante y se repitió la verificación de forma más estricta (comparando cada símbolo exportado contra su uso real en el archivo, sin asumir que toda referencia es una llamada) para descartar otros huecos similares.

## [0.52.3] - 2026-08-14

### Security
- **Corrección de bypass de ownership en `isItExecutiveUser` (`lib/authz.js`):**
  - **Comportamiento restrictivo por defecto:** `isItExecutiveUser` ya no trata a cualquier usuario autenticado como ejecutivo de IT cuando `SOPHIA_IT_EXECUTIVE_EMAILS`/`SOPHIA_IT_EXECUTIVE_AAD_OBJECT_IDS` no están configuradas. Con el comportamiento anterior, cualquier usuario podía ver el reporte ejecutivo (`handleExecutiveItTurn`) y saltarse el chequeo de solicitante/técnico asignado en acciones mutantes sobre tickets de otras personas (agregar notas, resolver, asignar). Ahora solo califican como ejecutivo los usuarios explícitamente listados en esas variables, más los administradores de soporte y de MCI.

### Ops
- **Extracción y cobertura de tests para autorización y confirmación de acciones (`lib/authz.js`, `lib/pending-actions.js`):**
  - **Módulos puros extraídos de `server.js`:** Se movieron las funciones de resolución de roles/ownership de tickets y la máquina de estados de acciones pendientes a `lib/authz.js` y `lib/pending-actions.js`, sin cambiar su comportamiento, para poder probarlas sin levantar el bridge completo.
  - **Suite de pruebas con Vitest:** Se agregó `vitest` (`npm test`) y 58 pruebas unitarias que cubren resolución de roles (admin/MCI admin/ejecutivo), ownership de tickets, permisos de edición de MCI, y el ciclo de vida completo de confirmación de acciones (crear, actualizar, confirmar, expirar).

## [0.52.2] - 2026-08-03

### Changed
- **Mapeo de Rutas en Consultas de SAP HANA (`agent-orchestrator.js`):**
  - **Uso Obligatorio de `U_TM_RUTAS`:** Modificadas las directrices de base de datos en el `SYSTEM_PROMPT` para instruir a Sophia a usar de manera autónoma y directa la columna `U_TM_RUTAS` ante cualquier consulta relacionada con rutas de SAP (ej: clientes, facturación o stock), evitando preguntar o confirmar al usuario.

## [0.52.1] - 2026-08-03

### Fixed
- **Precisión de Fechas en Consultas SQL (`agent-orchestrator.js`):**
  - **Validación del Calendario (Años No Bisiestos):** Agregada una directriz dura en el prompt del sistema (`SYSTEM_PROMPT`) para exigir la máxima precisión al calcular rangos de fecha en consultas de SAP HANA. Específicamente, previene que se generen fechas inválidas como `2026-02-29` (año no bisiesto), evitando errores críticos de SQL en la base de datos de producción.

## [0.52.0] - 2026-07-29

### Fixed
- **Envío Conjunto de Tarjetas y Texto en Teams (`server.js`):**
  - **Desbloqueo de Respuestas de Texto:** Corregido un cuello de botella arquitectónico donde el canal de Teams descartaba cualquier respuesta de texto si el turno generaba una tarjeta adaptativa. Ahora el bot envía la tarjeta y luego el texto analítico completo.
  - **Flujo de Resumen en Listas de MCI:** Eliminado el retorno temprano (`return;`) en el bridge al listar MCI (`sdp_list_requests`), permitiendo que el motor de IA procese las metas, efectúe su análisis explicativo y genere la mentoría o guía semanal.
  - **Envío de Parámetro de Consulta:** Configurado el envío del mensaje original en las opciones del resumidor (`summarizeToolOutput` y `streamToolSummary`) para contextualizar las metas analizadas.

## [0.51.0] - 2026-07-29

### Changed
- **Razonamiento y Exposición Proactiva en MCI (`agent-orchestrator.js`):**
  - **Interpretación de Resultados:** Sophia ya no se limita a mostrar tarjetas adaptativas pasivamente en consultas de MCI. Ahora acompaña cada listado o consulta con una explicación en lenguaje natural analizando cuáles metas van a tiempo y cuáles sufren rezagos.
  - **Recomendaciones Operativas:** Sugiere de forma autónoma ideas, alternativas técnicas y mitigaciones concretas para resolver los bloqueos descritos en el campo `predictiva` de las metas.

## [0.50.0] - 2026-07-29

### Added
- **Sophia como Mentora y Orientadora de MCI (`agent-orchestrator.js`):**
  - **Habilitación de Guía de Exposición Semanal:** Agregada una directriz estructurada en el `SYSTEM_PROMPT` para que Sophia ayude proactivamente a los miembros del equipo de IT a preparar su exposición semanal de avances ante la gerencia.
  - **Reconstrucción del Estado de la Meta:** El asistente consulta las MCI activas del usuario, analiza el avance físico actual, deduce las causas de retraso o bloqueo a partir del historial de la *predictiva* y arma un resumen ejecutivo estructurado con plan de acción/mitigación.
  - **Elevator Pitch de 1 Minuto:** Genera un guión verbal optimizado con tono constructivo, profesional y enfocado en soluciones para que el colaborador exponga de forma fluida frente a la gerencia.
  - **Diálogo Interactivo:** Si el sistema detecta que la predictiva está vacía o desactualizada, Sophia pregunta de forma proactiva al usuario para afinar los detalles de su guión de exposición.

## [0.49.2] - 2026-07-23

### Ops
- **Documentación de Comandos en Guía Operativa (`scripts/prod-help.js`):**
  - **Inclusión de `report:transcript`:** Integrado el nuevo comando de transcripción a la lista visible del menú de ayuda operativa en la sección "Auditoría y QA", detallando los parámetros requeridos (`--user`) y opcionales (`--format`, `--output`).

## [0.49.1] - 2026-07-23

### Added
- **Script de Transcripción de Conversaciones (`scripts/get-teams-transcript.js`):**
  - **Comando `report:transcript`:** Creado un nuevo comando ejecutable (`npm run report:transcript -- --user "Nombre"`) que busca de forma inteligente todas las conversaciones activas de un usuario en Teams leyendo `teams-audit.log`. Extrae y reconstruye la transcripción del diálogo completo en orden cronológico mostrando los mensajes del usuario y las respuestas/tarjetas de Sophia.

## [0.49.0] - 2026-07-23

### Security
- **Filtro de Destinatarios en Transmisión de Versiones (`server.js`):**
  - **Restricción a Administradores de Soporte:** Modificada la función de difusión `broadcastReleaseNotesToItStaff` para que las tarjetas adaptativas de actualización de versión solo se envíen proactivamente en Teams a los usuarios cuyas referencias coincidan con los correos definidos en `SUPPORT_ADMIN_EMAILS` o IDs de AAD en `TEAMS_ADMIN_AAD_OBJECT_IDS`.
  - **Restricción en Reportes Semanales:** Modificada la función `sendWeeklyExecutiveReportToExecutives` para filtrar y enviar el reporte ejecutivo únicamente a los administradores y directores de IT autorizados (`IT_EXECUTIVE_EMAILS` y `SUPPORT_ADMIN_EMAILS`), protegiendo la confidencialidad de la información corporativa.

## [0.48.3] - 2026-07-23

### Security
- **Restricción de Autorización Dura para SAP HANA (`server.js`):**
  - **Validación de Rol en Backend:** Añadida validación dura en el middleware de seguridad `assertToolAllowedForUser` para que la herramienta `sap_hana_query` solo pueda ser ejecutada si el usuario pertenece al grupo de administradores de soporte (`isSupportAdmin`). Esto garantiza a nivel de código que únicamente Luis Solano, Algis Morales y Yariela Saucedo de Vallarino puedan consultar datos de SAP HANA, rechazando cualquier intento no autorizado con una excepción explícita.

## [0.48.2] - 2026-07-23

### Fixed
- **Parseo de Respuestas Planas en SAP (`server.js`):**
  - **Soporte de Cadenas Planas Envueltas en JSON:** Corrección de un fallo visual en el formateador de tarjetas de SAP donde las respuestas del Gateway que devolvían oraciones explicativas planas envueltas en un objeto JSON (ej: `{"output":"The sum of... is 442903.20"}`) se mostraban como JSON crudo y feo en la tarjeta adaptativa. Ahora el parser detecta y extrae el campo `"output"` y lo renderiza de forma limpia como una oración en texto legible.

## [0.48.1] - 2026-07-23

### Ops
- **Planificador de Limpieza Automática de Gráficos (`chart-generator.js`, `server.js`):**
  - **Poda Automática de Imágenes Temporales:** Añadida la función `pruneOldCharts` para buscar e identificar imágenes de gráficos PNG antiguos que lleven más de 24 horas en el disco local y eliminarlos de forma segura para prevenir la saturación de espacio en disco del servidor.
  - **Planificador en Segundo Plano:** Añadido `startChartCleanupScheduler` que inicializa el limpiador tras arrancar el servidor Express, programando una revisión automática recurrente cada 4 horas utilizando temporizadores sin bloqueo (`timer.unref()`).

## [0.48.0] - 2026-07-23

### Added
- **Motor de Gráficos Genéricos para SAP HANA (`chart-generator.js`, `server.js`):**
  - **Generación Automática de Gráficos de Negocio:** Añadida la función `generateSapGenericChart` para renderizar gráficos de barras a partir de registros tabulares recuperados desde SAP HANA. Detecta dinámicamente columnas numéricas (ej. `DocTotal`, `DocSum`, `Quantity`) y etiquetas/fechas (`DocDate`, `CardName`, `ItemCode`) para construir la visualización de forma inteligente.
  - **Visualización en Tarjetas Adaptativas:** Si un usuario solicita un gráfico de SAP (como montos de compra/venta o stock), el backend intercepta el resultado de la consulta SQL (`sap_hana_query`) y embebe el gráfico dibujado directamente en el cuerpo de la tarjeta adaptativa, complementando la tabla de datos estructurada.
  - **Prompt del Sistema Actualizado:** Sophia ahora es consciente de que puede generar gráficos tanto para solicitudes de ServiceDesk Plus como para consultas de base de datos de SAP HANA, ejecutando la herramienta de base de datos correspondiente en silencio.

## [0.47.1] - 2026-07-23

### Fixed
- **Habilitación de Intenciones Gráficas en el Prompt (`agent-orchestrator.js`):**
  - **Instrucción de Generación de Gráficos:** Añadida una nueva instrucción en el `SYSTEM_PROMPT` para que Sophia sea consciente de su capacidad para generar gráficos visuales. Se le instruye a llamar a la herramienta `sdp_list_requests` cuando el usuario solicite un gráfico de tickets o MCI, en lugar de responder de forma negativa afirmando que no puede crear gráficos.

## [0.47.0] - 2026-07-23

### Added
- **Motor de Gráficos Locales para Teams (`chart-generator.js`, `server.js`):**
  - **Generador Autónomo en Servidor:** Implementación de generación local de gráficos estadísticos (PNG) mediante `canvas` y `chart.js` sin depender de APIs de terceros o de la nube.
  - **Detección Automática de Intención Visual:** Cuando un usuario en Teams solicita un reporte visual de tickets o de MCI utilizando palabras clave (`gráfico`, `pastel`, `barras`, etc.), Sophia intercepta la respuesta de `sdp_list_requests` y genera el gráfico correspondiente.
  - **Avance de MCI por Líder:** Genera gráficos de barras verticales a color (con código de semáforo basado en progreso: Verde >= 80%, Azul >= 40%, Rojo < 40%) mostrando el avance individual de cada MCI de un líder específico, junto con datos promedio en la tarjeta adaptativa.
  - **Carga de Tickets por Técnico:** Genera gráficos de barras horizontales mostrando la cantidad de tickets asignados a cada técnico de soporte activo.
  - **Directorio de Exportaciones Ignorado:** Configurado `.gitignore` para omitir la carpeta de gráficos temporales `public/exports/` y no ensuciar el repositorio.

## [0.46.1] - 2026-07-23

### Fixed
- **Normalización de Búsquedas en SAP HANA (`agent-orchestrator.js`):**
  - **Filtros Insensibles a Mayúsculas (`UPPER`/`LOWER`):** Añadida instrucción obligatoria en el prompt del sistema (`SYSTEM_PROMPT`) para que Sophia siempre aplique normalizaciones `UPPER`/`LOWER` tanto a las columnas como a los valores al generar queries SQL de SAP HANA (ej: `UPPER(CardCode) = UPPER('cl101011')`). Esto previene fallos de "No se encontraron datos" debido a la sensibilidad de HANA cuando el usuario ingresa códigos en minúsculas.

## [0.46.0] - 2026-07-23

### Added
- **Script de Reporte de Uso de Sophia en Teams (`scripts/report-teams-users.js`):**
  - **Generación de Reportes de Usuario:** Creado un nuevo script para analizar el archivo `teams-audit.log` y consolidar la información de todos los usuarios que han interactuado con Sophia a través de Microsoft Teams.
  - **Mapeo de Campos de Auditoría:** El script agrupa las interacciones de manera inteligente por ID de Teams (AadObjectId), mostrando el nombre del usuario, su ID SDP (si está mapeado), cantidad de mensajes enviados por el usuario, cantidad de respuestas enviadas por Sophia, total de interacciones, canales/chats usados (personal o grupal) y la fecha y hora de su primer y último uso.
  - **Soporte de Múltiples Formatos y Filtros:** Permite exportar o imprimir en formatos: `table` (por defecto en consola), `markdown`/`md` (`--format md`), `json` (`--format json`) y `csv` (`--format csv`). Admite filtros por fecha (`--since YYYY-MM-DD`), ordenamiento (`--sort messages|name|lastSeen`) y escritura directa en archivos con `--output <filepath>`.
  - **Comando NPM:** Añadido el script rápido `"report:teams"` a `package.json` para facilitar su ejecución directa como `npm run report:teams`.

## [0.45.3] - 2026-07-23

### Changed
- **Visualización Detallada de MCI en Listas (`server.js`, `sdp-mcp-server`):**
  - **Avance, Predictiva y Fecha de Actualización:** Añadidos explícitamente los campos de porcentaje de avance (`udf_long_1801`), comentarios predictivos (`udf_sline_2102`) y la última fecha de actualización (`udf_date_1508`) directamente en las tarjetas de lista de metas crucialmente importantes (MCI).
  - **Expansión de Campos en Consultas MCI:** Modificada la lista de campos requeridos por defecto en el backend de SDP (`getDefaultFieldsRequired`) para recuperar y entregar de manera nativa los campos adicionales de progreso, predictivo e historial en lotes.

## [0.45.2] - 2026-07-23

### Fixed
- **Corrección de Error 400 Bad Request en la Lista de Solicitudes (`sdp-mcp-server`):**
  - **Mapeo de Campos UDF Individuales (`fields_required`):** Se corrigió la consulta a la API REST v3 de ServiceDesk Plus que fallaba con un error de "Invalid Input" al solicitar el objeto completo `udf_fields` en la lista. Se reemplazó por la solicitud explícita e individual de los campos requeridos utilizando sus rutas anidadas (`udf_fields.udf_pick_1503` y `udf_fields.udf_pick_2701`), lo cual es completamente aceptado por la API de SDP.

## [0.45.1] - 2026-07-23

### Fixed
- **Resolución Inteligente de Nombres con Acentos para MCI y Técnicos (`sdp-mcp-server`):**
  - **Resolución de Nombres en SDP (`resolveUserFullName`):** Corrección del fallo de insensibilidad a acentos en búsquedas directas de ServiceDesk Plus (ej: "Purificacion Cardenas" no retornaba resultados si en la base de datos estaba como "Purificación Cárdenas").
  - **Búsqueda por Prefijos sin Acentos:** Si la búsqueda exacta por nombre falla, el backend divide el nombre por palabras y genera búsquedas por prefijos sin acentos (ej: "Purific" para "Purificación"), recupera los candidatos coincidentes, y luego realiza un matching local insensible a acentos sobre los nombres completos.
  - **Inclusión de `udf_fields` por Defecto:** Se fuerza la devolución de `udf_fields` en la consulta list_requests cuando se filtra por MCI o técnicos custom, permitiendo mapear y resolver el campo "Técnico asignado" (`udf_pick_2701`) y "Líder MCI" (`udf_pick_1503`) de forma transparente sin llamadas extras de detalle.
  - **Filtrado por `search_criteria` para Técnicos Custom:** Añadido filtrado nativo en SDP para la asignación de técnicos custom en la tabla de UDFs (`udf_fields.udf_pick_2701`).

## [0.45.0] - 2026-07-22

### Added
- **Subida Real de Archivos Adjuntos a ServiceDesk Plus desde Teams (`sdp-mcp-server`, `server.js`):**
  - **Soporte de Adjuntos multipart/form-data (`uploadAttachmentToSdp`):** Implementada la subida real de archivos y capturas de pantalla a la API REST v3 de SDP (`/requests/{id}/uploads`) mediante `form-data`.
  - **Nueva Herramienta MCP `sdp_upload_attachment`:** Permite adjuntar imágenes, capturas o PDFs codificados en Base64 a cualquier ticket de SDP de forma explícita.
  - **Integración Transparente en `sdp_create_request` y `sdp_add_note`:** Al recibir fotos o imágenes en Teams, el sistema captura automáticamente los datos binarios en la sesión (`session.lastImageAttachment`) y los adjunta como archivos reales al ticket o nota creada.

## [0.44.0] - 2026-07-22

### Added
- **Botones de Acción Directa (1-Clic) en Tarjetas Adaptativas de Teams (`server.js`):**
  - **Acciones Interactivas 1-Clic (`ActionSet`):** Incorporados botones interactivos `Action.Submit` directamente dentro de las tarjetas adaptativas de detalle de tickets (`[ 📝 Agregar Nota ]`, `[ 🔒 Solicitar Cierre ]`, `[ 📋 Mis Tickets ]`), listas de atención (`[ 🔍 Ver Detalle ]`, `[ 📝 Agregar Nota ]`) y proyectos MCI (`[ 📝 Actualizar Avance ]`, `[ 📋 Mis MCI ]`).
  - **Manejador de Payloads en Teams (`getTeamsText`, `server.js`):** Implementado el procesamiento de los eventos de clic (`__sophia_card_add_note`, `__sophia_card_close_ticket`, `__sophia_card_view_details`, `__sophia_card_list_my_tickets`, `__sophia_card_update_mci`, `__sophia_card_list_mci`) para permitir que los usuarios ejecuten o preparen acciones instantáneamente sin necesidad de escribir comandos en texto libre.

## [0.43.0] - 2026-07-22

### Added
- **Consultas de Detalle de Líneas de Documentos y Filtros por Cliente en SAP Business One (`agent-orchestrator.js`, `server.js`):**
  - **Detalle de Artículos por Documento (`DocNum`):** Mapeadas las tablas de detalle (`INV1`, `RIN1`, `DLN1`, `RDR1`, `QUT1`) unidas a la cabecera por `DocEntry` para consultar productos, cantidades, precios unitarios y totales de línea de una factura, pedido, remisión o nota de crédito específica.
  - **Filtro por Cliente o RUC:** Soporte para filtrar documentos por nombre comercial, Razón Social o RUC (`CardCode` / `CardName`).
  - **Mapeo de Campos Amigables (`formatSapFieldLabel`):** Añadidos alias visuales para `Dscription` (*Producto / Descripción*), `Quantity` (*Cantidad*), `Price` (*Precio Unitario*) y `LineTotal` (*Total Línea*).

### Security & Privacy
- **Política Estricta de Discreción e Invisibilidad de SAP:**
  - Se configuró la regla de seguridad para garantizar que NUNCA se incluyan ejemplos de consultas a SAP en las tarjetas de broadcast proactivo ni se sugieran capacidades de SAP a usuarios generales.
  - La herramienta `sap_hana_query` opera de forma estrictamente silenciosa y *on demand* únicamente cuando un usuario autorizado consulte explícitamente información administrativa de SAP.

## [0.42.11] - 2026-07-22

### Changed
- **Simplificación de Notificaciones Broadcast de Versión (`createReleaseBroadcastAdaptiveCard`, `getLatestReleaseHighlights`, `server.js`):**
  - **Foco Exclusivo en la ÚLTIMA Actualización:** Se eliminó el bloque estático de *"Capacidades Principales Activas"* para mostrar únicamente las novedades correspondientes a la versión actual que se está transmitiendo.
  - **Ejemplos Dinámicos de la ÚLTIMA Versión:** Se removieron los ejemplos heredados de versiones pasadas (PowerBI, diagnóstico de red, cuentas AD) y se implementó un generador dinámico de prompts (`generateExamplesForRelease`) que presenta únicamente los comandos de prueba asociados a las nuevas funcionalidades de la versión.

## [0.42.10] - 2026-07-22

### Fixed
- **Confirmación Clara de Registro de Nota en SDP (`executeDirectChatTool`, `minimizeValue`, `server.js`):**
  - **Identificación del problema:** Al ejecutar `sdp_add_note` con éxito en el chat directo, la respuesta JSON de SDP (`{ note: {...}, response_status: {...} }`) se filtraba en `minimizeValue` descartando la clave `note`. Al pasar la salida a `summarizeToolOutput`, el modelo generativo confundía el resultado con una consulta de búsqueda vacía y respondía erróneamente *"Parece que la operación se completó con éxito, pero no se encontraron resultados para tu consulta"*.
  - **Solución:** 
    1. Se añadió un formateador de éxito directo para `sdp_add_note` en `executeDirectChatTool` que devuelve de inmediato: *"Listo, agregué la nota de seguimiento al ticket #XXXXX."* con sus respectivas opciones accionables.
    2. Se incluyeron las claves `note`, `notes`, `status_code` y `result` en la lista blanca de `minimizeValue` para conservar la estructura del payload devuelto por SDP.
    3. Se agregaron reglas explícitas para `sdp_add_note` en `getSummarySystemInstruction`.

## [0.42.9] - 2026-07-22

### Fixed
- **Flujo de Confirmación Conversacional y Ejecución Directa de Notas (`server.js`, `agent-orchestrator.js`):**
  - **Corrección de Bloqueo por `CONFIRMATION_WORDS` (`server.js`):** Cuando el usuario respondía *"si"* o *"ok"* durante una conversación donde NO existía una tarjeta adaptativa de confirmación pendiente en `session.pendingActions`, el sistema interceptaba la palabra e interumpía abruptamente el diálogo con *"No tengo una acción pendiente para confirmar"*. Se actualizó el manejador de Teams para permitir que las respuestas afirmativas/negativas sin tarjeta pendiente pasen directamente al orquestador de IA.
  - **Ejecución Inmediata de `sdp_add_note` (`agent-orchestrator.js`):** Se instruyó explícitamente a Gemini para que ejecute `sdp_add_note` de inmediato de forma automatizada cuando se disponga del ID del ticket (`request_id`) y del texto de la nota (`note_text`), prohibiendo preguntas de confirmación en texto libre (`¿Te parece bien que agregue la nota...?`).

## [0.42.8] - 2026-07-22

### Fixed
- **Corrección de Columna de Cliente en Consultas de Documentos SAP Business One (`agent-orchestrator.js`):**
  - **Identificación del problema:** Al consultar documentos directos (Notas de Crédito `ORIN`, Facturas `OINV`, Remisiones `ODLN`, Pedidos `ORDR`, Cotizaciones `OQUT`), el orquestador incluía la columna `"CardFName"`, provocando el error `la columna "CardFName" no se encuentra en la tabla "ORIN"`.
  - **Solución:** Se actualizó la regla de consulta SQL SAP HANA aclarando que las cabeceras de documentos contienen `"CardName"` (y `"CardCode"`), mientras que `"CardFName"` (Nombre Comercial) pertenece únicamente al maestro de socios de negocio (`OCRD`). Se instruyó seleccionar `"CardName"` en consultas directas de documentos sin JOIN.

## [0.42.7] - 2026-07-22

### Fixed
- **Esquema Obligatorio y Diccionario de Tablas SAP Business One (`agent-orchestrator.js`):**
  - **Calificación Obligatoria de Esquema:** Se instruyó explícitamente a Gemini en la regla 9 de `sap_hana_query` que TODAS las tablas deben ir prefijadas con el esquema `"C2910638_BARCIA_PRD"` (ej. `"C2910638_BARCIA_PRD"."ORIN"`). Se corrigió la falla *"El nombre de la tabla 'ORIN' no es válido"* al consultar notas de crédito sin prefijo de esquema.
  - **Diccionario de Tablas SAP:** Incluidas equivalencias oficiales:
    - Notas de Crédito: `"C2910638_BARCIA_PRD"."ORIN"`
    - Facturas de Venta: `"C2910638_BARCIA_PRD"."OINV"`
    - Entregas / Remisiones: `"C2910638_BARCIA_PRD"."ODLN"`
    - Pedidos / Órdenes: `"C2910638_BARCIA_PRD"."ORDR"`
    - Cotizaciones: `"C2910638_BARCIA_PRD"."OQUT"`
    - Socios de Negocio: `"C2910638_BARCIA_PRD"."OCRD"`
    - Artículos / Productos: `"C2910638_BARCIA_PRD"."OITM"`
    - Stock por Bodega: `"C2910638_BARCIA_PRD"."OITW"`
  - **Consultas de ÚLTIMOS Registros:** Instrucción explícita de usar `ORDER BY "DocNum" DESC` o `ORDER BY "DocDate" DESC` junto a `TOP N`.
  - **Categorización Visual de Notas de Crédito (`server.js`):** Añadida categoría 💳 **Notas de Crédito** a `detectSapQueryMeta` para presentar estas tarjetas con ícono y encabezado personalizado en Teams.

## [0.42.6] - 2026-07-22

### Fixed
- **Validación Robusta de Permisos para Notas de Seguimiento (`assertToolAllowedForUser`, `userCanAccessRequest`, `userMatchesAssignedTechnician`):**
  - **Solicitantes (Requesters):** Mejorada la coincidencia por ID de solicitante, correo exacto, prefijo de correo antes del `@` y nombre completo normalizado. Evita rechazos indebidos cuando el correo o dominio difieren ligeramente en SDP.
  - **Técnicos Asignados (Assigned Technicians):** Añadida verificación directa por correo de técnico (`technician.email_id` / `technician.email`) e ID técnico (`technician.id`), además de la coincidencia por nombre normalizado. Previene que técnicos asignados reciban rechazo al agregar notas.
  - **Administradores y Ejecutivos (Support Admins & IT Executives):** Incluidos expresamente `isItExecutiveUser` e `isMciAdmin` junto a `isSupportAdmin` para permitir el registro de notas de seguimiento sin restricciones.
- **Reintento Automático de Payload en Servidor MCP (`sdp-mcp-server`):**
  - Añadido fallback automático en `sdp_add_note` de `sdp-mcp-server`: si el endpoint `/requests/{id}/notes` rechaza la propiedad `show_to_requester` (error 4001/4000), realiza un segundo intento limpio enviando únicamente `{ note: { description: note_text } }`.

## [0.42.5] - 2026-07-22

### Fixed
- **Mensaje honesto en cierre de ticket cuando SDP no permite agregar notas (`handleTicketCancellationTurn`):**
  - Cuando `sdp_add_note` falla (error 4002 permiso en SDP), el usuario ya no recibe falsamente "El ticket ha sido cancelado exitosamente". Ahora recibe un mensaje claro indicando que la solicitud quedó pendiente y debe notificar al técnico asignado para el cierre formal.
  - Cuando `sdp_add_note` tiene éxito, el mensaje confirma que la Mesa de Ayuda fue notificada.
- **Eliminado campo `is_public` de args de `sdp_add_note`:** Esta versión de SDP On-Premise no acepta ese campo (error 4001 Extra key). El MCP usa correctamente `show_to_requester` internamente.

## [0.42.4] - 2026-07-22

### Fixed
- **Detección ampliada de solicitudes de cierre de ticket (`handleTicketCancellationTurn`):**
  - El regex de detección ahora captura variantes naturales en español que antes fallaban silenciosamente: *"solicito se cierre el ticket"*, *"ya no es necesario"*, *"era una prueba"*, *"quiero cancelar esta solicitud"*, *"por favor cierra el ticket"*, *"quisiera cerrar mi solicitud"*, etc.
  - Antes, estos mensajes pasaban al AI general que intentaba usar `sdp_add_note` directamente y fallaba con el error genérico.
- **Mensaje de error mejorado para `sdp_add_note`:**
  - Cambiado el mensaje genérico confuso *"No pude completar esa consulta porque falló la conexión con sdp_add_note"* por uno contextual y útil que indica que el técnico asignado puede agregar la nota directamente en el portal.

## [0.42.3] - 2026-07-22

### Changed
- **Tarjetas SAP estructuradas y enriquecidas (`createSapQueryResultAdaptiveCard`):**
  - Reescritura completa del formateador de tarjetas de resultados SAP en Teams.
  - Nueva función `parseSapTextToRecords()` que parsea la salida de texto libre de n8n y extrae registros clave-valor estructurados.
  - Nueva función `detectSapQueryMeta()` que detecta automáticamente el tipo de consulta (Clientes, Inventario, Facturas, Vendedores, Bodegas) y asigna ícono, título y color contextual.
  - Nueva función `formatSapFieldLabel()` con diccionario de etiquetas amigables para campos SAP (CardFName→Cliente, ItemCode→Código Item, DocNum→N° Documento, etc.).
  - Cada registro SAP se despliega como un Container con filas de 2 columnas (etiqueta | valor), alternando estilos `default`/`emphasis` para mejor legibilidad.
  - Header con ícono grande, título del tipo de datos y contador de registros en tiempo real.
  - Límite de 50 registros visibles con aviso si hay más resultados disponibles.
  - Footer discreto con instrucción de refinamiento de consulta.

## [0.42.2] - 2026-07-22

### Fixed
- **Habilitación de `sdp_add_note` en `READ_ONLY_CHAT_TOOLS` (`server.js`):**
  - Añadido `sdp_add_note` al conjunto de herramientas autorizadas para ejecución directa en el chat (`READ_ONLY_CHAT_TOOLS`), resolviendo definitivamente el mensaje de rechazo *"No puedo ejecutar esa herramienta porque no está autorizada para el chat."*.
  - Se mantiene la validación estricta de seguridad en `assertToolAllowedForUser` para asegurar que solo el solicitante original, el técnico asignado o un admin puedan agregar notas a un ticket.

## [0.42.1] - 2026-07-22

### Fixed
- **Validación Estricta de Permisos para Notas de Seguimiento (`assertToolAllowedForUser`):**
  - Implementada la validación de propiedad y asignación para `sdp_add_note`. Sophia verifica antes de enviar cualquier nota que el usuario autenticado sea **el solicitante original del ticket**, **el técnico asignado** o un **administrador de soporte**.
  - Si un usuario no autorizado intenta agregar notas a tickets ajenos, el sistema rechaza la acción con el mensaje: *"Solo el solicitante del ticket o el técnico asignado pueden agregar notas de seguimiento a esta solicitud."*

## [0.42.0] - 2026-07-22

### Fixed
- **Optimización Total de Agregar Notas y Eliminación de Textos Duplicados (`sdp_add_note`):**
  - Removido `sdp_add_note` de `TOOLS_REQUIRING_CONFIRMATION`. Ahora agregar una nota aclaratoria a un ticket se ejecuta directamente de forma instantánea sin requerir confirmación explícita ni generar error `4002`.
  - Corregido `createTeamsConfirmationCardBody` para evitar la duplicación de texto entre `intro` y `summaryText` en las tarjetas de confirmación.

## [0.41.5] - 2026-07-22

### Fixed
- **Prioridad Máxima del Interceptor de Cancelación de Tickets (`runSupportTurn`):**
  - Movido `handleTicketCancellationTurn` a la primera posición de la cadena de interceptores en `runSupportTurn`. Esto evita que las peticiones de cierre conversacionales pasen al orquestador de Gemini y sigan invocando mutaciones de la API restringidas por ServiceDesk Plus.

## [0.41.4] - 2026-07-22

### Fixed
- **Mejora del Módulo de Cancelación de Tickets (`handleTicketCancellationTurn`):**
  - Reconocimiento dinámico de frases conversacionales como *"cierra este ticket"* o *"cerrar ticket"*.
  - Redirección automática de la acción hacia el módulo de cancelación de tickets de Sophia (`handleTicketCancellationTurn`), agregando la nota aclaratoria directamente a ServiceDesk Plus (`sdp_add_note`) en lugar de intentar una mutación directa de estado restringida por la API (`status_code: 4002: User does not have this permission`).

## [0.41.3] - 2026-07-22

### Fixed
- **Uso Obligatorio de `CardFName` para Nombres de Clientes en Consultas SAP (`agent-orchestrator.js`):**
  - Configurada la regla estricta en Gemini para seleccionar y desplegar siempre el campo `CardFName` (Nombre Comercial/Fantástico) al consultar o mostrar clientes en SAP HANA, en lugar del nombre legal `CardName`.

## [0.41.2] - 2026-07-22

### Fixed
- **Ampliación del Límite de Resultados SQL SAP (`agent-orchestrator.js`):**
  - Ampliada la regla de restricción de resultados de Gemini de `TOP 50` a `TOP 100` en la herramienta `sap_hana_query`.

## [0.41.1] - 2026-07-22

### Fixed
- **Optimización de Consultas SQL a SAP HANA y Mapeo de Campos (`agent-orchestrator.js` & `server.js`):**
  - Incorporadas reglas de esquema en Gemini indicando que el campo de asignación de rutas en la tabla `OCRD` es `U_TM_RUTAS` (evitando búsquedas por campos inexistentes como `U_Ruta` que provocaban escaneos completos y colapsos).
  - Obligatoriedad de la cláusula `TOP 50` para acotar los resultados y prevenir timeouts en consultas sobre la tabla masiva de clientes (`OCRD` con 15,000+ registros).
  - Incrementado el timeout de pasarela a 45,000 ms.

## [0.41.0] - 2026-07-22

### Added
- **Diseño de Tarjetas Adaptativas Elegantes para Resultados Empresariales (`createSapQueryResultAdaptiveCard`):**
  - Implementada la función `createSapQueryResultAdaptiveCard` en `server.js` para interceptar las respuestas de la herramienta `sap_hana_query` en Teams y presentarlas dentro de un contenedor estilizado (`style: emphasis`).
  - Limpieza automática de artefactos de código o tablas markdown desalineadas (`|---|---|`, `[phone-redacted]`).
  - Mantiene la discreción ejecutiva presentando el resultado como *"Resultados de la Consulta"*.

## [0.40.4] - 2026-07-22

### Fixed
- **Formato Estructurado de Payload n8n para SAP HANA (`executeSapHanaQuery`):**
  - Ajustado el cuerpo de la petición POST a n8n enviando `{ action: 'sendMessage', sessionId: ..., chatInput: sqlQuery }` y extrayendo directamente el atributo `response.data.output`.
  - Verificada y validada la respuesta HTTP 200 OK en vivo obteniendo datos reales del esquema `C2910638_BARCIA_PRD`.

## [0.40.3] - 2026-07-22

### Fixed
- **Actualización de la URL de Pasarela N8N para SAP HANA (`executeSapHanaQuery`):**
  - Actualizada la dirección por defecto a `http://192.170.1.209:5678/webhook/df0596a7-f358-480b-8d66-dd51bfc114c6/chat`.

## [0.40.2] - 2026-07-22

### Fixed
- **Importación de Módulo `axios` en `server.js`:**
  - Importado `axios` explícitamente en la cabecera de `server.js` (`import axios from 'axios';`), resolviendo la excepción `axios is not defined` al ejecutar consultas HTTP contra la pasarela SAP HANA.

## [0.40.1] - 2026-07-22

### Added
- **Enriquecimiento de Logs de Diagnóstico para SAP Gateway (`executeSapHanaQuery`):**
  - Añadido registro explícito en consola con los prefijos `[SAP Gateway]` y `[SAP Gateway Error Detallado]` registrando la URL destino, la sentencia SQL ejecutada, el código HTTP de respuesta y el payload exacto de error en caso de fallos.

## [0.40.0] - 2026-07-22

### Added
- **Conector Directo HTTP/Pasarela para Consultas SAP HANA (`executeSapHanaQuery`):**
  - Implementada la función `executeSapHanaQuery` en `server.js` para enviar consultas SQL `SELECT` directamente a la pasarela HTTP de SAP HANA (`SAP_HANA_GATEWAY_URL`, por defecto `http://192.170.1.209:5678/webhook/sap-hana-query`).
  - Eliminado la dependencia de subprocesos Stdio independientes en producción, optimizando el tiempo de respuesta en milisegundos y la estabilidad del servidor PM2.

## [0.39.3] - 2026-07-22

### Fixed
- **Discreción de Mensajes Intermedios para `sap_hana_query` (`createWorkingMessage`):**
  - Ajustado `createWorkingMessage` y `onStatus` para que, cuando Gemini devuelva un mensaje borrador en `content` (ej: *"Claro, reviso en SAP HANA..."*), Sophia intercepte el mensaje previo y lo remplace por frases sutiles y ejecutivas (*"Claro, reviso esa información y te comparto el resumen"*), asegurando que el nombre técnico y el backend no sean expuestos al usuario.

## [0.39.2] - 2026-07-22

### Added
- **Soporte de Arquitectura Multiserver MCP para Conexión SAP HANA (`sapMcpClient`):**
  - Implementado cliente Stdio secundario `sapMcpClient` en `server.js` para conectar con el servidor MCP de SAP HANA (`sap-mcp-server/build/index.js`).
  - Actualizado el enrutador de herramientas `callMcpTool` para dirigir dinámicamente las llamadas de `sap_hana_query` hacia el motor MCP de SAP HANA.

## [0.39.1] - 2026-07-22

### Fixed
- **Mensaje de Error Discreto para Consultas SAP (`sap_hana_query`):**
  - Personalizada la respuesta en caso de falla de conexión con la base de datos de SAP HANA para evitar exponer el nombre interno de la herramienta `sap_hana_query` o mencionar ServiceDesk Plus, respondiendo de forma sutil y natural: *"No pude consultar la información de SAP en este momento. Por favor verifica los datos ingresados o intenta nuevamente en unos minutos."*

## [0.39.0] - 2026-07-22

### Added
- **Integración Discreta 'On-Demand' de Consultas de Solo Lectura a SAP HANA (`sap_hana_query`):**
  - Habilitada la herramienta MCP `sap_hana_query` dentro de las herramientas autorizadas para lectura en chat (`READ_ONLY_CHAT_TOOLS`).
  - Configurado Gemini con directiva de uso **discreto e interactivo bajo demanda**: Sophia ejecutará consultas SQL `SELECT` en la base de datos `C2910638_BARCIA_PRD` ÚNICAMENTE cuando un usuario pregunte por stock, inventarios, facturas o entregas.
  - La habilidad se mantiene oculta en saludos, menús de bienvenida y guías de capacidades para no promocionar activamente funciones fuera del alcance técnico.

## [0.38.0] - 2026-07-21

### Added
- **Opción 24 — Programación de Mantenimientos Preventivos y Detección de Ventanas Activas (`getActiveMaintenanceWindow`):**
  - Registro conversacional de mantenimientos preventivos planificados por departamento o servicio (`startTime`, `endTime`, `equipmentType`, `areaName`).
  - Detección proactiva de ventanas de mantenimiento activas cuando los usuarios reportan lentitud o fallas en servicios en mantenimiento planificado.
  - Alerta preventiva informativa especificando la hora de restablecimiento automático, previniendo tickets duplicados por trabajos programados de TI.

## [0.37.0] - 2026-07-21

### Added
- **Opción 23 — Generación y Exportación de Reportes en Excel / CSV (`generateTicketsCsvReport`):**
  - Generador automático de consolidados en formato CSV estructurado en UTF-8 con codificación BOM (`\uFEFF`) para apertura directa y limpia en Microsoft Excel.
  - Endpoint de descargas seguras `/exports` servido desde la carpeta estática del servidor web.
  - Tarjeta adaptativa de 1-clic `createReportExportAdaptiveCard` con botón `[📥 Descargar Reporte (CSV/Excel)]`.
  - Control de acceso reservado para Gerencia IT y Administradores de Soporte.
  - Almacén de auditoría de reportes en `data/report_exports_history.json`.

## [0.36.0] - 2026-07-21

### Added
- **Opción 22 — Detección y Prevención de Tickets Duplicados en Tiempo Real (`checkForDuplicateRequest`):**
  - Búsqueda preventiva en ServiceDesk Plus de solicitudes abiertas del mismo usuario con coincidencia semántica de asunto o categoría.
  - Inyección de banner preventivo en la tarjeta de confirmación de Teams (`createCreateRequestConfirmationBlock`) advirtiendo la existencia de un ticket abierto previo (ej. Ticket `#14820 - Falla de acceso a SAP`).
  - Orientación al usuario para unificar comentarios o decidir la creación de una solicitud independiente.

## [0.35.2] - 2026-07-21

### Added
- **Conocimiento RAG sobre el Origen e Historia del Nombre "Sophia" (`knowledge/historia-nombre-sophia.md`):**
  - Incorporada la respuesta estructurada y elegante para preguntas sobre el origen del nombre (*"¿Por qué te llamas Sophia?"* / *"¿Quién te puso ese nombre y por qué?"*).
  - Incluye desglose etimológico (del griego *Σοφία* - Sabiduría), contextos filosóficos (Grecia Antigua, Filosofía, Hagia Sophia, Tradición Gnóstica) y cualidades asociadas a su identidad operacionales (Ponderación, Empatía y Elegancia/Claridad).

## [0.35.1] - 2026-07-21

### Improved
- **Indicador Visual Continuo de Retroalimentación en Teams (`context.sendActivity({ type: 'typing' })`):**
  - Implementado un temporizador de pulso activo (`typingInterval` cada 3.5 segundos) durante el procesamiento de respuestas de Sophia en Teams.
  - Ahora Microsoft Teams mantendrá la animación visual continua de **"Sophia está escribiendo..."** durante búsquedas largas en SDP, RAG, procesamiento de audio/imágenes o generación de reportes ejecutivos, evitando la sensación de congelamiento o demora sin respuesta.

## [0.35.0] - 2026-07-21

### Added
- **Opción 21 — Validación de Identidad por OTP (6 dígitos) para Acciones Críticas de AD:**
  - Generación de códigos numéricos de seguridad de 6 dígitos con validez de 5 minutos (`generateSecurityOtpChallenge`).
  - Almacén de trazabilidad y auditoría de retos en `data/security_otp_challenges.json`.
  - Tarjeta adaptativa interactiva `createOtpChallengeAdaptiveCard` con campo para ingresar código y botón de 1-clic `[🔐 Validar Código OTP]`.
  - Integración obligatoria de seguridad antes de autorizar el desbloqueo de cuenta en Active Directory (`handleSecurityOtpTurn` / `handleAdAccountTurn`).

## [0.34.0] - 2026-07-21

### Fixed / Changed
- **Detección de Incidentes Masivos exclusiva para Tickets Creados (`trackAndDetectMajorIncidentCluster`):**
  - Removido el registro automático de incidentes durante la conversación, chats o diagnósticos conversacionales.
  - La contabilización de afectaciones en tiempo real (Opción 7) ahora ocurre **ÚNICAMENTE tras la creación confirmada de un ticket real en ServiceDesk Plus** (`sdp_create_request`).
  - Prevenido al 100% que consultas como *"diagnostico de red"*, *"verificar sap"* o preguntas en el chat activen falsas alertas de incidente mayor o cuenten como reportes de usuarios afectados.

## [0.33.4] - 2026-07-21

### Fixed
- **Filtro de Consultas en Detección de Incidentes Masivos (`extractMajorIncidentSystem`):**
  - Excluidas las solicitudes de búsqueda, consulta o reportería de tickets (*"muéstrame los tickets..."*, *"ver tickets de internet..."*, *"buscar solicitudes..."*) del motor de conteo de afectaciones en tiempo real (Opción 7).
  - Prevenido el falso positivo donde una consulta administrativa o reporte de incidentes pasados registraba un nuevo reporte de usuario afectado o desplegaba la tarjeta de prevención de duplicidad en lugar de listar los tickets en SDP.

## [0.33.3] - 2026-07-21

### Fixed
- **Reconocimiento de Peticiones de Diagnóstico y Chequeo en Tiempo Real (`isNetworkDiagnosticsRequest`):**
  - Ampliados los patrones de captura conversacional para frases como *"Chequeo en tiempo real sap"*, *"chequeo real"*, *"monitoreo en tiempo real"*, *"verificar sap"* y *"chequeo de red"*.
  - Ahora el backend captura estas solicitudes en Nivel 1 ejecutando `handleNetworkDiagnosticsTurn` y desplegando la Adaptive Card con la latencia real de los servidores (SAP ERP, Gateway local, FortiClient VPN, M365, Impresoras).

## [0.33.2] - 2026-07-21

### Fixed
- **Habilitación de Consultas Corporativas y de Negocio en Gemini (`agent-orchestrator.js`):**
  - Actualizado el `SYSTEM_PROMPT` de Gemini para indicarle explícitamente que Sophia es también la asistente de la Base de Conocimientos Corporativa de Barraza & Cía.
  - Instrucción para responder consultas de productos, marcas, catálogo e historia directamente desde `retrieved_knowledge` cuando el RAG recupere los fragmentos, eliminando la negativa de *"no manejo información de negocio"*.

## [0.33.1] - 2026-07-21

### Added
- **Base de Conocimientos RAG sobre Marcas y Portafolio de Barraza & Cía (`knowledge/empresa-barraza-marcas.md`):**
  - Mapeo completo de las marcas corporativas por categoría: Sip, Spum, 10, Romeo, Rocío, 4D, Julieta, Americano, Sip Bebé y EcoGreen.
  - Formatos de presentación (polvo, líquido, barra, crema).
  - Detalle especializado de la línea *Sip Bebé* (inocuidad química superior y limpiador de biberones) y *Sip EcoGreen* (sustentabilidad y ahorro de agua).
  - Contexto de sustitución de importaciones y resiliencia de la cadena de suministro panameña desde 1957.

## [0.33.0] - 2026-07-21

### Added
- **Base de Conocimientos RAG sobre Barraza & Cía, S.A. (`knowledge/empresa-barraza-productos.md`):**
  - Incorporada información corporativa: Historia desde 1957, lema, compromiso de sostenibilidad y trazabilidad de manufactura nacional.
  - Catálogo de las 4 categorías químicas principales: Detergentes, Suavizantes, Lavaplatos y Desinfectantes.
  - Segmentación de mercado: Diferencias entre catálogo Hogar (Home) e Institucional (Institutional 2024-2025) con normativas y MSDS.
  - Nuevos lanzamientos: New Multipurpose, New Disinfectant y New Image (Nueva Imagen).
  - Canales oficiales de contacto técnico y comercial (Tel: 2673325, Email: `barraza@bacosa.com`).

## [0.32.1] - 2026-07-21

### Fixed
- **Dashboard Ejecutivo personalizado para Gerente IT (`createExecutiveItReportCard`):**
  - Eliminada la sección de carga por técnico individual para el perfil ejecutivo gerencial (Yariela Saucedo).
  - Métricas superiores ajustadas al contexto gerencial: Tickets Totales, Tickets Abiertos, MCI Activas y CSAT Promedio.
  - Opciones de seguimiento reemplazadas por acciones estratégicas: avance MCI por líder y CSAT de la semana.
  - Los administradores operativos (técnicos) mantienen la vista completa con carga individual.

## [0.32.0] - 2026-07-21

### Added
- **Opción 16 — Alerta Preventiva de Vencimiento de Contraseñas de Windows/AD:**
  - Diagnóstico interactivo de caducidad de contraseña corporativa con indicador 🟢/⚠️ y fecha de vencimiento.
  - Auditoría de alertas emitidas en `data/password_expiration_alerts.json`.
- **Opción 17 — Solicitud y Préstamo Asistido de Equipos de Respaldo:**
  - Reserva interactiva de laptops, proyectores y módems MiFi para viajes o eventos corporativos (`handleLoanEquipmentTurn`).
  - Botón `[💻 Confirmar Solicitud de Préstamo]` con registro en `data/loan_equipment_requests.json`.
- **Opción 18 — Estado de Salud de Sedes e Infraestructura IT en Tiempo Real:**
  - Monitoreo de 7 nodos: Casa Matriz, David, Santiago, Chitré, Colón, SAP ERP y M365 (`handleInfrastructureHealthTurn`).
  - Tarjeta adaptativa con indicadores 🟢/🟡/🔴 y botón `[🔄 Re-ejecutar Diagnóstico]`.
  - Histórico de verificaciones en `data/infrastructure_health_history.json`.

## [0.29.0] - 2026-07-21

### Added
- **Opción 13 — Cancelación de Tickets Duplicados en Teams (1-Clic):**
  - Anulación interactiva de solicitudes desde Teams con botones `[❌ Cancelar Ticket Definitivamente]` y `[↩️ Mantener Ticket Abierto]`.
  - Trazabilidad y auditoría en `data/ticket_cancellations_history.json`.
- **Opción 14 — Programación Asistida de Mantenimiento Preventivo:**
  - Agendamiento asistido de revisiones preventivas de computadoras, impresoras Zebra/HP y equipos de departamento (`handlePreventiveMaintenanceTurn`).
  - Botón de confirmación `[📅 Agendar Mantenimiento]` e histórico en `data/preventive_maintenance_schedule.json`.
- **Opción 15 — Asistente de Onboarding y Guías de Inducción en PDF:**
  - Catálogo interactivo de guías rápidas (Correo en Celular, FortiClient VPN, SAP Básico).
  - Entrega de resumen ejecutable y enlace a manuales oficiales en PDF (`data/onboarding_guides_history.json`).

## [0.26.0] - 2026-07-21

### Added
- **Opción 12 — Sugerencias Inteligentes de Auto-Resolución por Categoría (Deflection KBA):**
  - Motor de detección de consultas desviables (`isDeflectionEligibleRequest` / `getDeflectionMatch`) para fallas comunes de Nivel 1 (Outlook, FortiClient VPN, Barraza Móvil, Wi-Fi).
  - Tarjeta adaptativa interactiva de auto-solución de 30 segundos con botones de 1-clic `[✅ Solucionado (No crear ticket)]` y `[🎫 Crear Ticket de Soporte]`.
  - Histórico de auditoría y medición de desvío en `data/deflection_history.json`.

## [0.25.0] - 2026-07-21

### Added
- **Opción 11 — Envío Automatizado de Reportes Semanales PDF a la Gerencia (`sendWeeklyExecutiveReportToExecutives`):**
  - Compilador de métricas semanales de rendimiento (tickets procesados, cumplimiento SLA %, promedio CSAT, MCI resueltos y artículos KBA creados).
  - Integración de envío de tarjetas ejecutivas a Teams y notificación por correo a la lista gerencial (`IT_EXECUTIVE_EMAILS`).
  - Endpoint administrativo `POST /api/admin/weekly-report` y script CLI `scripts/send-weekly-report.js` (`npm run prod:weekly-report`).
  - Histórico de trazabilidad en `data/weekly_reports_history.json`.

## [0.24.0] - 2026-07-21

### Added
- **Opción 10 — Procesamiento de Notas de Voz en Teams (Audio-to-Ticket):**
  - Detección y extracción automática de notas de voz y archivos de audio (`.m4a`, `.wav`, `.mp3`, `.ogg`, `.opus`) adjuntos por Teams (`getTeamsAudioAttachments`).
  - Motor de transcripción e inferencia de intención IA (`transcribeTeamsAudioAttachment`) para procesar el contenido hablado de usuarios en movimiento o planta.
  - Tarjeta adaptativa de confirmación con la transcripción completa (`createAudioTranscriptionCard`) y generación automática de tickets en ServiceDesk Plus con la transcripción y el audio como evidencia.
  - Histórico de auditoría en `data/audio_transcriptions_history.json`.

## [0.23.2] - 2026-07-20

### Changed
- **Enriquecimiento de Tarjetas de Notificación Proactiva de Versión (`createReleaseBroadcastAdaptiveCard`):**
  - Añadido resumen visual de todas las capacidades clave activas (Aprobación de Licencias, Auto-Diagnóstico de Red Nivel 1, Autogestión de AD, Detector de Incidentes Masivos, Dashboard Ejecutivo y Análisis de Evidencias por Imagen).
  - Actualizadas las sugerencias de frases de prueba con ejemplos prácticos para cada módulo.
## [0.42.4] - 2026-07-22

### Fixed
- **Optimización del Parser de Novedades (`getLatestReleaseHighlights`):**
  - Corregida la extracción de versiones en `CHANGELOG.md` para garantizar el despliegue correcto de las notas de la  "version": "0.42.5",` en las tarjetas de broadcast de Teams.

## [0.23.1] - 2026-07-20

### Fixed
- **Extracción Dinámica de Novedades desde `CHANGELOG.md` (`getLatestReleaseHighlights`):**
  - Reemplazada la lista estática en código por un parser dinámico que lee los viñetas exactos de la última versión en `CHANGELOG.md`. Ahora las tarjetas de broadcast reflejan fielmente las características específicas introducidas en cada versión (v0.42.4, v0.23.0, etc.).

## [0.23.0] - 2026-07-20

### Added
- **Opción 9 — Flujo de Aprobación de Licencias de Software en Teams (1-Clic):**
  - Registro automático de solicitudes de licencias corporativas (PowerBI Pro, M365, Visio, Adobe, SAP, AutoCAD) en `data/software_license_approvals.json`.
  - Tarjetas adaptativas de aprobación enviadas directamente al chat de Teams del líder/aprobador con los botones **`[✅ Aprobar Licencia]`** y **`[❌ Rechazar Solicitud]`**.
  - Notificación inmediata de decisión y actualización de estado en ServiceDesk Plus.

## [0.22.0] - 2026-07-20

### Added
- **Opción 8 — Auto-Diagnóstico Asistido de Red e Impresoras (`runNetworkDiagnostics`):**
  - Chequeos de conectividad en tiempo real sobre la infraestructura de Barraza & Cía. (Servidor SAP, Gateway local, FortiClient VPN, Internet/DNS e Impresoras Zebra/HP).
  - Tarjeta adaptativa de resultados en Nivel 1 con indicadores visuales 🟢/🟡/🔴, tiempos de respuesta (latencia ms) y botones de acción rápida **`[🔄 Re-ejecutar Diagnóstico]`** y **`[🎫 Crear Ticket con Diagnóstico Adjunto]`**.
  - Registro de auditoría local en `data/network_diagnostics_history.json`.

## [0.21.2] - 2026-07-20

### Fixed
- **Entregabilidad de Mensajes Proactivos en Teams (`continueConversationAsync`):**
  - Integrada la captura y persistencia de referencias de conversación de Bot Framework (`saveTeamsConversationReference`) en `data/teams-conversation-references.json`.
  - Conectado `broadcastReleaseNotesToItStaff` con `teamsAdapter.continueConversationAsync` para entregar físicamente la tarjeta adaptativa de novedades directamente en el chat privado de Teams de cada usuario de IT.

## [0.21.1] - 2026-07-20

### Fixed
- **Resiliencia de Conexión CLI Loopback (`127.0.0.1`):**
  - Actualizados los scripts `scripts/broadcast-release.js` y `scripts/trigger-reminders.js` para priorizar la IP de loopback `127.0.0.1` sobre `localhost`, resolviendo fallos de resolución de DNS en Node 18+ cuando el servidor se reinicia o escucha exclusivamente en IPv4.

## [0.21.0] - 2026-07-20

### Added
- **Transmisión Proactiva de Novedades y Versiones a Personal IT (`broadcastReleaseNotesToItStaff`):**
  - Sistema de notificación proactiva en Teams para informar automáticamente al equipo de IT sobre cada nueva actualización y versión desplegada.
  - Tarjeta adaptativa interactiva con encabezado `🚀 ¡Hola! Sophia ha sido actualizada a la versión v0.21.0`, resumen automático de características y sugerencias de comandos de prueba rápida.
  - Almacén de persistencia `data/release_broadcasts.json` para evitar envíos duplicados por versión.
  - Script ejecutable CLI `"prod:broadcast": "node scripts/broadcast-release.js"` y endpoint `POST /api/admin/release/broadcast`.

## [0.20.0] - 2026-07-20

### Added
- **Opción 6 — Autogestión y Desbloqueo de Active Directory (`handleAdAccountTurn`):**
  - Verificación del estado de cuenta en Active Directory (AD) para detectar cuentas bloqueadas (`locked_out`) por reintentos fallidos de contraseña.
  - Tarjeta adaptativa interactiva en Teams con el botón **`[🔓 Desbloquear Mi Cuenta de AD]`** para desbloqueo automático con 1-clic.
  - Almacén de persistencia `data/active_ad_mock.json` para emulación y pruebas de dominio.

- **Opción 7 — Detección Inteligente de Incidentes Masivos y Caídas (`handleMajorIncidentPreventiveTurn`):**
  - Rastreador en tiempo real con ventana móvil de 15 minutos para detectar 3 o más reportes coincidentes de un mismo servicio (ej. SAP, VPN, Red).
  - Activación automática de **Incidente Mayor de Servicio (Major Incident Cluster)** al alcanzar el umbral de 3 afectaciones coincidentes.
  - Tarjeta de respuesta preventiva para usuarios con botón **`[🔔 Notificarme cuando se resuelva]`**, evitando la duplicación de tickets.

## [0.19.5] - 2026-07-20

### Fixed
- **Aislamiento de la Gestión de Situaciones Activas (`parseActiveSituationAdminCommand`):**
  - Excluidos los mensajes sobre MCI, tickets o IDs específicos (`mci`, `ticket`, `solicitud`, `#ID`) del módulo de administración de situaciones activas.
  - Prevenida la falsa captura que interpretaba la actualización de una MCI (ej. *"actualizar la MCI 12862"*) como una solicitud de actualización de situación activa de sistema (`mci 12862`), asegurando que pase al orquestador conversacional para ejecutar `sdp_update_mci`.

## [0.19.4] - 2026-07-20

### Fixed
- **Aislamiento de la Revisión de Candidatos de Aprendizaje (`parseKnowledgeCandidateReviewCommand`):**
  - Removido la palabra comodín `borrador` de las activaciones generales de revisión de conocimiento para evitar interceptaciones accidentales al crear o actualizar borradores de tickets/MCI.
  - Asegurado que cualquier solicitud sobre MCI o tickets (`mci`, `ticket`, `solicitud`) pase de forma directa al orquestador conversacional sin desplegar la tarjeta de candidatos de aprendizaje.

## [0.19.3] - 2026-07-20

### Fixed
- **Aislamiento de Despliegue de Dashboard Ejecutivo (`isExecutiveItReportRequest`):**
  - Excluidas solicitudes de edición, actualización o consulta de tickets/MCI específicos (`actualizar`, `modificar`, `editar`, `#ID`) de la regla de captura del Dashboard Ejecutivo.
  - Asegurado que peticiones como *"actualizar la descripción de la MCI"* o *"actualizar esta MCI al día de hoy"* pasen directamente al flujo de actualización de MCI (`sdp_update_mci`) sin desplegar el informe gerencial.

## [0.19.2] - 2026-07-20

### Fixed
- **Normalización de Fechas y Timestamp Epoch para SDP (`normalizeSdpDateValue`):**
  - Implementada la función `normalizeSdpDateValue` para convertir automáticamente cualquier fecha enviada como string (ej. `"07/20/2026"`, `"20/07/2026"`, `"hoy"`) al formato epoch timestamp exacto esperado por ServiceDesk Plus (`{ value: "1784524800000" }`).
  - Resuelto el desbordamiento de meses en SDP que causaba que la fecha `"07/20/2026"` se interpretara erróneamente como día 7 del mes 20 (provocando el salto a `07/08/2027`).

## [0.19.1] - 2026-07-20

### Fixed
- **Mapeo de Campos UDF en Actualizaciones de MCI (`sdp_update_mci`):**
  - Mapeado el campo UDF de fecha `udf_date_1508` a su nombre de campo lógico `current_date` en `normalizeMciUpdateFields` y `createMciUpdateConfirmationBlock`.
  - Corregido `prepareConfirmedActionArgs` para normalizar y formatear fechas relativas de MCI (`current_date`) antes de llamar a la API de ServiceDesk Plus al presionar el botón "Confirmar".

## [0.19.0] - 2026-07-20

### Added
- **Adjunto Automático de Evidencias Visuales (Opción 4):**
  - Integrada la vinculación de imágenes y capturas de pantalla adjuntas en Teams a las descripciones y notas de tickets en ServiceDesk Plus.
- **Flujo de Confirmación de Solución y Cierre de Tickets (Opción 5):**
  - Creada la tarjeta adaptativa interactiva `createSolutionConfirmationAdaptiveCard` con botones `[✔ Sí, Confirmar y Calificar]` y `[🔄 No, Reabrir Ticket]`.
  - Creado el manejador de turno `handleSolutionConfirmationTurn` en `server.js` para procesar confirmaciones directas, encuestas CSAT post-cierre y solicitudes automáticas de reapertura con nota para el técnico.

## [0.18.1] - 2026-07-20

### Fixed
- **Acceso y Activación del Dashboard Ejecutivo en Teams:**
  - Flexibilizada la regla de autorización `isItExecutiveUser` para permitir el acceso a administradores de soporte (`isSupportAdmin`) y permitir el despliegue cuando la variable de entorno de ejecutivos está abierta.
  - Ampliados los patrones de coincidencia `isExecutiveItReportRequest` para responder de inmediato a comandos como `"dashboard"`, `"ver dashboard"`, `"salud del servicio IT"`, etc.

## [0.18.0] - 2026-07-20

### Added
- **Panel de Salud y Métricas del Servicio IT (Opción 3):**
  - Enriquecido el reporte ejecutivo conversacional con métricas de distribución de categorías con mayor volumen de incidentes (`getExecutiveCategoryDistribution`).
  - Añadido el cálculo consolidado del nivel de satisfacción CSAT (`getExecutiveCsatSummary`) con visualización de estrellas y promedio acumulado.
  - Creado el bloque adaptativo `createExecutiveCategoriesBlock` y ampliados los patrones de detección conversacionales (*"salud del servicio IT"*, *"dashboard de soporte"*, *"métricas IT"*).

## [0.17.0] - 2026-07-20

### Added
- **Notificación Proactiva Matutina a las 8:30 AM (Modalidad 2 de Recordatorios):**
  - Implementado el temporizador diario `scheduleDaily830AmReminders` en `server.js` configurado para ejecutarse a las 8:30 AM de lunes a viernes (zona horaria `America/Panama`).
  - Añadido el endpoint de administración `POST /api/admin/reminders/trigger` para forzar la revisión proactiva en cualquier momento.
  - Creado el script ejecutable `scripts/trigger-reminders.js` (`npm run prod:reminders`).

## [0.16.0] - 2026-07-20

### Added
- **Recordatorios Automáticos de Tickets En Espera (Opción 2):**
  - Creada la tarjeta adaptativa interactiva de recordatorio `createStaleTicketReminderAdaptiveCard` con campo de texto para ingresar respuesta rápida y botón `[📝 Enviar Respuesta al Ticket]`.
  - Creado el manejador de turno `handleStaleTicketReminderTurn` en `server.js` para consultar tickets en estado `En Espera` inactivos por 2 o más días.
  - Registra las respuestas directamente como notas estructuradas en ServiceDesk Plus (`sdp_add_note`) y notifica al técnico asignado.

## [0.15.0] - 2026-07-20

### Added
- **Encuestas de Satisfacción Rápida CSAT (Opción 1):**
  - Creada la tarjeta adaptativa interactiva de micro-encuesta CSAT (`createCsatSurveyAdaptiveCard`) con selección de 1 a 5 estrellas y comentario opcional.
  - Implementado el manejador de turno `handleCsatTurn` en `server.js` para registrar automáticamente las evaluaciones como notas estructuradas en ServiceDesk Plus (`sdp_add_note`).
  - Añadida la opción interactiva "Calificar la atención del ticket #ID" en los detalles de tickets resueltos o cerrados.
  - Integrada la respuesta en Teams y Web con tarjeta de agradecimiento personalizada (`createCsatConfirmationAdaptiveCard`).

## [0.14.0] - 2026-07-20

### Added
- **Triage de Tickets Rezagados o En Espera de Respuesta (Opción 3):**
  - Ampliadas las frases de activación en `isStaleTicketsRequest` (`server.js`) para capturar consultas como *"qué tickets necesitan respuesta"*, *"tickets en espera"*, *"tickets rezagados"* o *"triage"*.
  - Actualizado `agent-orchestrator.js` para instruir a Gemini a llamar a `sdp_list_requests` con filtrado de tickets rezagados/estancados.
  - Presenta resúmenes ejecutivos con días transcurridos desde el último movimiento y sugerencias de seguimiento.

## [0.13.1] - 2026-07-20

### Added
- **Rutas Determinísticas para VPN, Carpetas Compartidas y Licencias (Opción 2):**
  - Añadidas las rutas `network_shared_folders` (`Red / Red Local`), `software_licenses` (`Softwares / Office`) y ampliada `network_vpn` (`Red / VPN`) con patrones para FortiClient, Fortinet y teletrabajo.
  - Agregados casos de prueba automatizados en `scripts/check-routing.js` (24 rutas validadas, 20/20 casos de prueba superados con 100% de precisión).
  - Actualizada la documentación en `knowledge/catalogo-sdp.md` y re-indexado el índice RAG (109 fragmentos).

## [0.13.0] - 2026-07-20

### Added
- **Línea de Tiempo y Seguimiento Visual del Ticket/MCI (Opción 1):**
  - Creadas las funciones generadoras de indicadores de estado `buildTicketStatusTimeline` y `buildMciStatusTimeline` en `server.js`.
  - Integrado un bloque visual de progreso en las tarjetas adaptativas de detalle de ticket y MCI (`[✔ Creado] ➔ [🔵 En Proceso] ➔ [🟡 En Espera] ➔ [🟢 Resuelto]`).
  - Actualizadas las instrucciones de formateo de resúmenes en `getSummarySystemInstruction` para incluir la línea de tiempo en el flujo conversacional.

## [0.12.0] - 2026-07-20

### Added
- **Nivel 3 de Inteligencia: Búsqueda Web de Soporte General (`web_search_support`):**
  - Creada e integrada la herramienta `web_search_support` en `server.js` y `agent-orchestrator.js` para consultar fuentes técnicas oficiales (Microsoft Support, HP, Zebra) ante errores generales de software/hardware (códigos de error de Windows/Office/Outlook/Excel).
  - Incluye sanitizador de seguridad (`sanitizeWebSearchQuery`) que remueve nombres de la empresa, correos, nombres de empleados e IPs privadas antes de consultar la web.
  - Formateador de respuestas con citación de fuentes oficiales.

## [0.11.1] - 2026-07-20

### Added
- **Sugerencias de Auto-Solución Rápida (Opción A):**
  - Integrado un bloque `💡 Sugerencia de Auto-Solución Rápida:` dentro de la Fase 1 de borrador del ticket en `agent-orchestrator.js`.
  - Sophia ahora extrae automáticamente 1 o 2 pasos prácticos de auto-recuperación desde los playbooks RAG (Outlook, Impresoras, Red, etc.) para ofrecerlos al usuario antes de emitir la confirmación final.

## [0.11.0] - 2026-07-20

### Added
- **Proceso de Creación de Tickets en 2 Fases:**
  - **Fase 1 (Pre-redacción y Pulido):** Sophia primero presenta en texto normal la propuesta estructurada del **Asunto** y la **Descripción** (📌 Problema, 🔍 Detalle y Síntomas, ⚡ Impacto) e inicia un diálogo de retroalimentación conversacional para ajustar cualquier detalle.
  - **Fase 2 (Tarjeta de Confirmación Final):** Únicamente cuando el usuario aprueba explícitamente la redacción o pide generar la solicitud, Sophia invoca `sdp_create_request` y muestra la tarjeta adaptativa final con los botones `[Confirmar]` y `[Cancelar]`.

## [0.10.10] - 2026-07-20

### Fixed
- Eliminado el punto (`.`) de la expresión regular de teléfonos en `redactSensitiveText` en `server.js` y actualizado el reemplazo con `replaceAll` para garantizar que ninguna dirección IPv4 o puerto vuelva a ser enmascarado como número telefónico.

## [0.10.9] - 2026-07-20

### Fixed
- Corregida la sanitización de teléfonos en `redactSensitiveText` en `server.js` para proteger direcciones IPv4 e IPv4 con puertos (ej. `192.168.1.50`, `181.xxx.xxx.xxx:80`), evitando que fueran reemplazadas erróneamente por `[phone-redacted]`.

## [0.10.8] - 2026-07-20

### Fixed
- Corregida la duplicación de encabezados (`📌 Problema o Solicitud:`) en `formatStructuredTicketDescription` cuando la IA o el usuario reenvían descripciones con títulos preexistentes.
- Corregida la función `stripHtml` en `server.js` para preservar saltos de línea (`\n\n`) y saltos de párrafo/lista, evitando que las descripciones y notas se aplanen en un solo bloque continuo dentro de las tarjetas adaptativas de Teams y visor de SDP.

## [0.10.7] - 2026-07-20

### Added
- Formateador automático de descripciones estructuradas (`formatStructuredTicketDescription`) en `server.js` para asegurar que las descripciones de tickets creados por Sophia incluyan encabezados limpios (`📌 Problema o Solicitud:`, `🔍 Detalle y Síntomas:`, `⚡ Impacto Operativo:`) y viñetas ordenadas.
- Actualizadas las instrucciones del orquestador (`agent-orchestrator.js`) para orientar a la IA a generar descripciones en secciones legibles con saltos de línea dobles.

## [0.10.6] - 2026-07-17

### Added
- Agregadas las rutas deterministas `mudanzas` (categoría `Mudanzas`) y `suministros` (categoría `Suministros`, subcategoría `Tintas` por defecto) en `ticket-routing.js` para clasificar correctamente solicitudes de traslados de equipo y requisiciones de insumos/tóner de oficina.
- Nuevos casos de prueba RAG y de enrutamiento asociados en `scripts/test-rag.js`, `scripts/check-routing.js` y `knowledge/catalogo-sdp.md`.

## [0.10.5] - 2026-07-17

### Fixed
- Corregida la subcategoría de impresoras en `ticket-routing.js` eliminando la referencia inexistente `Honeywell` y solucionando un error tipográfico en la categoría por defecto (ahora apunta correctamente a `Impresoras`).

### Added
- Separada la ruta de impresoras en dos reglas específicas: `printer_zebra` (apunta a `Impresoras / Zebra Etiquetas` para etiquetas y códigos de barras) y `printer` (apunta a `Impresoras / HP` para impresoras generales/oficina).
- Actualizados los playbooks de impresoras y los casos de prueba de comportamiento RAG en correspondencia.

## [0.10.4] - 2026-07-17

### Added
- Se añade justificación automatizada e indicadores de impacto en la descripción de los tickets creados con prioridad `Alta` para facilitar el triage de soporte y cumplir las reglas de calidad en la auditoría de tickets (`qa:tickets`).

## [0.10.3] - 2026-07-17

### Added
- Agregada la ruta determinista `microsoft_365_email` en `ticket-routing.js` para clasificar automáticamente solicitudes de Outlook, correo, Teams, OneDrive y licencias de Office.
- La ruta mapea correctamente a la categoría `Correo` y subcategoría `Envió & Recepción` en ServiceDesk Plus.

### Fixed
- Agregados casos de prueba y validaciones de comportamiento para la nueva ruta en `scripts/test-rag.js` y `scripts/check-routing.js`.

## [0.10.2] - 2026-07-17

### Fixed
- Corregido error en pruebas RAG (`scripts/test-rag.js`) haciendo que las validaciones de términos esperados sean insensibles a mayúsculas y minúsculas.
- Ajustado el área de validación para periféricos y audífonos hacia `soporte` para alinearlo con el enrutamiento correcto hacia playbooks de diagnóstico.

### Ops
- Limpieza de la base de candidatos de conocimiento, marcando los 13 candidatos de QA como aplicados (`applied_to_knowledge`) y regenerando exitosamente el índice RAG.

## [0.10.1] - 2026-07-17

### Changed
- Al crear un ticket confirmado, Sophia responde con un resumen operativo del ticket creado y opciones contextuales.
- El ticket creado se recuerda con asunto, prioridad, categoría y técnico para continuar la conversación con referencias como "ese ticket".

## [0.10.0] - 2026-07-17

### Added
- Sophia puede editar una solicitud pendiente antes de confirmarla, aplicando cambios directos sobre el borrador vigente.
- Soporta ediciones naturales de asunto, prioridad y descripcion, incluyendo agregar texto al inicio o al final.

### Changed
- Las ediciones de una solicitud preparada ya no dependen de que Gemini reconstruya el ticket desde cero; se actualiza la accion pendiente y se reenvia la tarjeta de confirmacion.

## [0.9.9] - 2026-07-17

### Changed
- Las tarjetas de confirmacion y detalle muestran descripciones mas largas y las dividen en bloques legibles para evitar truncamiento temprano en Teams.

## [0.9.8] - 2026-07-17

### Fixed
- Sophia reconoce respuestas breves a preguntas de prioridad, como "bloquea mi trabajo", y evita repetir la encuesta completa.

## [0.9.7] - 2026-07-17

### Fixed
- Sophia normaliza alias de creación como `request_subject`, `title` o `summary` hacia `subject` antes de clasificar, confirmar y crear tickets.

## [0.9.6] - 2026-07-17

### Changed
- La encuesta de prioridad ya no se muestra para solicitudes de servicio bien clasificadas como automatizacion/reportes, SAP reportería, DNS/web hosting o contraseñas.

### Fixed
- Sophia deja de interrumpir ediciones de una solicitud preparada, como agregar texto a la descripcion, con preguntas de priorizacion innecesarias.

## [0.9.5] - 2026-07-17

### Added
- Se agrega la ruta `automation_reporting` para solicitudes de automatizacion de Excel, macros, reportes automaticos y WMS.
- Se incorpora `knowledge/automatizaciones-reportes.md` como playbook RAG para reportes operativos y automatizaciones.

### Fixed
- Sophia deja de clasificar solicitudes de automatizacion Excel/WMS como `Contraseñas / Usuario Windows`.

## [0.9.4] - 2026-07-17

### Changed
- `knowledge:status` ahora muestra comandos recomendados con un candidato real y ejemplos usando `--reason`.

### Ops
- El flujo de revisión de conocimiento queda más guiado para aprobar, descartar, exportar, validar y marcar candidatos como aplicados.

## [0.9.3] - 2026-07-17

### Added
- `knowledge:review` acepta `--reason` para documentar el motivo al aprobar, descartar o marcar aplicado un candidato.

### Ops
- La auditoria de candidatos registra el motivo de revision o aplicacion para dejar trazabilidad operativa.

## [0.9.2] - 2026-07-17

### Added
- `qa:tickets` acepta `--emit-candidates` para convertir hallazgos QA en candidatos de conocimiento pendientes de revisión.

### Ops
- Los candidatos emitidos por QA se deduplican por fingerprint y se integran al flujo `knowledge:review`, `knowledge:polish` y `knowledge:status`.

## [0.9.1] - 2026-07-17

### Added
- Se agrega `npm run qa:tickets` para auditar calidad de tickets creados por Sophia: errores SDP, baja confianza, ruta default, campos faltantes, prioridades altas sin evidencia y rutas/categorías más usadas.

### Ops
- `prod:help` incluye el reporte QA de tickets para orientar mejoras de clasificación con evidencia real.

## [0.9.0] - 2026-07-17

### Added
- Se agrega `npm run knowledge:polish` para convertir candidatos aprobados en bloques de conocimiento mas limpios y listos para revision humana.

### Ops
- `prod:help` incluye el flujo de pulido de conocimiento aprobado antes de incorporarlo al RAG.

## [0.8.9] - 2026-07-17

### Added
- Se agrega `npm run knowledge:status` para resumir pendientes, aprobados, aplicados, descartados, archivos RAG relevantes y proxima accion sugerida.

### Ops
- `prod:help` incluye el nuevo tablero rapido del ciclo de conocimiento.

## [0.8.8] - 2026-07-16

### Added
- `knowledge:review` permite marcar candidatos como `applied_to_knowledge` con `--applied kc_xxxxx --target knowledge/<archivo>.md`.

### Ops
- El ciclo de aprendizaje queda trazado como pendiente, aprobado, exportado manualmente y aplicado a la base de conocimiento.

## [0.8.7] - 2026-07-16

### Added
- Se agrega `npm run knowledge:export` para convertir candidatos aprobados en un borrador Markdown revisable antes de incorporarlos manualmente a `knowledge/`.

### Ops
- `prod:help` incluye el comando de exportación de conocimiento aprobado.

## [0.8.6] - 2026-07-16

### Added
- Se agrega `npm run knowledge:review` para listar candidatos de conocimiento, ver detalle por ID, aprobarlos o descartarlos desde consola.

### Ops
- `prod:help` incluye el nuevo flujo de revisión de candidatos de conocimiento.

## [0.8.5] - 2026-07-16

### Ops
- Se agrega `npm run prod:help` para listar scripts operativos, comandos directos utiles y flujo recomendado de despliegue en produccion.

## [0.8.4] - 2026-07-16

### Added
- Se agrega conocimiento RAG sobre Barraza Movil: app Android de vendedores para rutas, clientes, cobertura, No Ventas, mapas, GPS, fotos de fachada y operación comercial en campo.

### Changed
- Las solicitudes sobre Barraza Móvil se clasifican como casos de app móvil en la ruta `Teléfonos / Celulares` cuando no exista una categoría más específica.
- El enrutamiento determinístico reconoce señales como Barraza Móvil, rutas asignadas, cobertura de ventas, No Ventas, foto de fachada y coordenadas GPS.

## [0.8.3] - 2026-07-16

### Fixed
- Sophia no trata errores históricos de permisos o configuración al agregar seguimientos como definitivos si el usuario vuelve a pedir la acción con ticket y nota disponibles.
- Los reintentos de seguimientos vuelven a pasar por `sdp_add_note` para que el backend actual valide permisos y ejecute con la configuración vigente.

## [0.8.2] - 2026-07-16

### Fixed
- Los administradores de soporte pueden agregar seguimientos a tickets generales luego de validar que el ticket existe en ServiceDesk Plus.
- Los técnicos asignados pueden agregar seguimientos a tickets donde figuran como responsables.

## [0.8.1] - 2026-07-16

### Changed
- El análisis de imágenes en Teams se interpreta como evidencia general de soporte, no solo como reporte de errores.
- Sophia puede usar capturas para enriquecer descripciones, notas de seguimiento, contexto operativo, acuerdos visibles o evidencia de avance.

## [0.8.0] - 2026-07-16

### Added
- Sophia puede analizar capturas e imágenes adjuntas en Teams usando Gemini multimodal.
- El análisis visual extrae texto visible, señales técnicas, posible clasificación SDP y preguntas útiles para continuar.
- Las evidencias visuales se incorporan como contexto para responder o preparar tickets, sin adjuntar todavía la imagen al ticket en SDP.

### Ops
- La auditoría Teams registra conteo de imágenes recibidas, imágenes analizadas y errores de descarga/análisis.

## [0.7.6] - 2026-07-16

### Fixed
- La sección `Seguimientos` elimina duplicados entre notas e historial de SDP.
- Se ocultan marcadores técnicos del historial como `#History_In_File#` y valores compuestos solo por correos.

## [0.7.5] - 2026-07-16

### Fixed
- Las tarjetas de seguimiento dejan de sugerir comandos con el ID de ejemplo `#12345` y usan el ticket real cuando está disponible.

### Ops
- La auditoría de tarjetas Teams registra señales sobre secciones de seguimiento, historial, correo y notas para facilitar diagnóstico en producción.

## [0.7.4] - 2026-07-16

### Changed
- Sophia usa también el historial de ServiceDesk Plus como fuente de seguimientos cuando la API no expone conversaciones por correo en un endpoint separado.
- El detalle de tickets puede extraer comentarios desde eventos de historial (`NOTE`) y mostrarlos como `Historial` en la tarjeta.

## [0.7.3] - 2026-07-16

### Changed
- El detalle de tickets trata notas, conversaciones y correos devueltos por ServiceDesk Plus como seguimientos del ticket.
- La tarjeta de seguimiento etiqueta cada entrada por origen (`Nota`, `Correo` o `Conversación`) e incluye autor y fecha cuando SDP los entrega.

## [0.4.5] - 2026-07-14

### Fixed
- Sophia deja de afirmar éxito total al agregar seguimientos si el MCP no puede verificar que la nota aparezca luego en ServiceDesk Plus.

## [0.4.4] - 2026-07-14

### Fixed
- Las confirmaciones exitosas de seguimientos responden con un mensaje directo de éxito en lugar de pasar por el resumen general de herramientas.

## [0.4.3] - 2026-07-14

### Fixed
- Evita que las solicitudes de seguimiento, notas, comentarios o evidencia activen la aclaración admin de solicitante vs Técnico asignado.

## [0.4.2] - 2026-07-14

### Fixed
- El detalle de tickets reconoce más formatos de notas devueltos por SDP y muestra un aviso cuando no hay seguimientos o cuando no se pudieron consultar.

## [0.4.1] - 2026-07-14

### Added
- El detalle de tickets en Teams muestra la sección `Seguimientos` cuando SDP devuelve notas del ticket.

## [0.4.0] - 2026-07-14

### Added
- Agregada memoria operativa ligera del último ticket relevante por conversación.
- Sophia puede resolver referencias como `ticket anterior`, `último ticket`, `ese ticket` o `ticket recién creado` para consultar detalle, agregar seguimiento o preparar cambios con confirmación.
- La memoria se persiste en `data/runtime-state.json` junto con sesiones y acciones pendientes.

### Changed
- El contexto seguro enviado al modelo incluye `operational_memory.lastTicket` para continuidad conversacional.
- Al consultar, listar o crear tickets, Sophia actualiza automáticamente el último ticket recordado.

### Fixed
- Los seguimientos de tickets usan `sdp_add_note`; si la IA intenta usar `sdp_update_request` con `fields.notes`, el backend lo convierte automáticamente a nota de seguimiento.

## [0.3.0] - 2026-07-14

### Added
- Agregado modo triage para priorización antes de preparar tickets sin impacto claro.
- Sophia ahora pregunta alcance, bloqueo operativo, impacto en procesos críticos y tiempo de ocurrencia para sugerir prioridad más confiable.
- Agregado playbook RAG `knowledge/playbooks/triage-prioridad.md`.

### Changed
- La prioridad sugerida puede elevarse a `Alta` cuando el caso bloquea una operación crítica, afecta a varios usuarios o impacta ventas, despacho, producción o facturación.
- La clasificación de tickets conserva prioridades explícitas indicadas por el usuario.

### Fixed
- Evita que una prioridad `Alta` inferida por la IA o por la ruta del catálogo salte el triage cuando el usuario no indicó impacto crítico.
- Evita repetir el triage cuando el usuario ya respondió alcance, bloqueo parcial o fecha de inicio con frases naturales.

## [0.2.0] - 2026-07-14

### Added
- Agregado `npm run prod:daily-report` para generar reportes diarios Markdown de Sophia.
- El reporte resume actividad Teams, uso de herramientas, tickets creados, errores, confirmaciones y alertas operativas.
- Los reportes diarios se generan en `reports/daily/` y quedan ignorados por git.

## [0.1.5] - 2026-07-14

### Ops
- `prod:monitor` ya no alerta cuando no hay actividad de Teams en la ventana revisada.
- `Teams audit` ahora marca WARN solo si hay errores o mensajes recibidos sin respuesta registrada.

## [0.1.4] - 2026-07-14

### Ops
- `prod:monitor:write` ahora registra alertas deduplicadas cuando cambia el estado WARN/FAIL.
- Agregado estado persistente del monitor en `reports/prod-monitor-state.json`.
- Agregado log de cambios de alerta en `reports/prod-monitor-alerts.log`.

## [0.1.3] - 2026-07-14

### Ops
- Agregado `npm run prod:monitor:write` para escribir el último reporte operativo y un histórico acumulado.
- Los reportes generados `reports/prod-monitor-latest.txt` y `reports/prod-monitor-history.log` quedan ignorados por git.
- El comando acepta la misma ventana de monitoreo con `-- --minutes <n>`.

## [0.1.2] - 2026-07-14

### Ops
- Agregado `npm run prod:monitor` para revisar señales operativas recientes en una sola vista.
- El monitor resume PM2, health local, auditoría Teams, auditoría de herramientas, SDP debug y tráfico Nginx.
- El monitor acepta ventana configurable con `-- --minutes <n>` o `SOPHIA_MONITOR_WINDOW_MINUTES`.

## [0.1.1] - 2026-07-14

### Ops
- Agregada configuración PM2 versionada en `ecosystem.config.cjs`.
- Agregados scripts npm para operar Sophia con PM2: `pm2:start`, `pm2:restart`, `pm2:status` y `pm2:logs`.
- `prod:check` ahora valida Sophia en PM2 y conserva compatibilidad temporal con `sophia.service`.
- `prod:version` reporta estado PM2 además del estado systemd legado.
- Runbook actualizado con instalación, migración, operación diaria y rollback temporal de PM2.
- Backup operativo incluye `ecosystem.config.cjs` y dump PM2 cuando existe.

## [0.1.0] - 2026-07-14

### Added
- Línea base formal de Sophia en piloto Teams.
- Diagnóstico guiado antes de crear tickets para fallas frecuentes.
- Playbooks RAG para monitor, red/internet, impresoras, SAP, periféricos, celulares y cuentas/contraseñas.
- Búsqueda tolerante a acentos y mayúsculas para MCI por líder y tickets por técnico asignado.

### Changed
- Sophia debe pedir datos operativos mínimos antes de crear tickets pobres en contexto, salvo urgencia o instrucción explícita de crear de todos modos.
- Las respuestas en Teams priorizan tarjetas y formatos más legibles para tickets y MCI.

### Fixed
- Correcciones de clasificación para monitor, periféricos, celulares, internet, SAP reportería y web hosting/DNS.
- Manejo más claro de errores internos de SDP como `udf_pick_2701`, evitando pedir al usuario campos técnicos.

### Security
- Validación por tenant de Teams, controles Bot Framework y ownership checks contra SDP.
- Acciones mutantes protegidas por confirmación explícita.

### Ops
- Healthcheck de producción, backup, runbook, logrotate y persistencia ligera de estado runtime.
