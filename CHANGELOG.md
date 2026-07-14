# Changelog Sophia

Todas las mejoras relevantes de Sophia deben registrarse aquí antes de desplegar a producción.

Formato recomendado:
- `Added`: capacidades nuevas.
- `Changed`: cambios de comportamiento.
- `Fixed`: correcciones.
- `Security`: controles de seguridad, permisos o auditoría.
- `Ops`: cambios de despliegue, monitoreo o operación.

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
