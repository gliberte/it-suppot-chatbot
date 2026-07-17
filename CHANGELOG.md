# Changelog Sophia

Todas las mejoras relevantes de Sophia deben registrarse aquí antes de desplegar a producción.

Formato recomendado:
- `Added`: capacidades nuevas.
- `Changed`: cambios de comportamiento.
- `Fixed`: correcciones.
- `Security`: controles de seguridad, permisos o auditoría.
- `Ops`: cambios de despliegue, monitoreo o operación.

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
