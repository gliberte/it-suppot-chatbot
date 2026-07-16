# Changelog Sophia

Todas las mejoras relevantes de Sophia deben registrarse aquí antes de desplegar a producción.

Formato recomendado:
- `Added`: capacidades nuevas.
- `Changed`: cambios de comportamiento.
- `Fixed`: correcciones.
- `Security`: controles de seguridad, permisos o auditoría.
- `Ops`: cambios de despliegue, monitoreo o operación.

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
