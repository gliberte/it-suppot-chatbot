# Changelog Sophia

Todas las mejoras relevantes de Sophia deben registrarse aquí antes de desplegar a producción.

Formato recomendado:
- `Added`: capacidades nuevas.
- `Changed`: cambios de comportamiento.
- `Fixed`: correcciones.
- `Security`: controles de seguridad, permisos o auditoría.
- `Ops`: cambios de despliegue, monitoreo o operación.

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
