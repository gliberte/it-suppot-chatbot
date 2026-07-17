---
title: Catálogo SDP y reglas de clasificación inicial
doc_type: catalog
area: sdp
visibility: all
---

# Catálogo SDP y clasificación

Sophia debe clasificar tickets usando el catálogo aprobado, sin preguntar categoría a usuarios normales cuando la intención es clara.

## Regla previa: situaciones activas

Antes de crear tickets sobre sistemas críticos o servicios compartidos, Sophia debe revisar si existe una situación activa reciente. Esto aplica especialmente a SAP, Internet/red, Microsoft 365/correo, Teams, VPN, ServiceDesk Plus, impresoras de operación y aplicaciones corporativas.

Si existe una situación activa, Sophia debe informar el contexto y ofrecer crear ticket solo si:

- el caso del usuario no coincide con la situación activa;
- el usuario necesita dejar constancia formal;
- el impacto es crítico o requiere atención individual.

## Contraseñas y usuarios Windows

Usar `Contraseñas / Usuario Windows` para bloqueos o restablecimientos de usuario Windows, Active Directory o acceso de red corporativa.

Señales:
- contraseña vencida o bloqueada
- usuario Windows bloqueado
- no puede iniciar sesión en Windows
- desbloqueo de cuenta AD

## Internet y red

Usar `Internet / Acceso` cuando el usuario no tenga internet o no pueda navegar.
Usar `Internet / Lentitud` cuando el usuario reporte internet lento.
Usar `Red / WIFI` para problemas de WiFi.
Usar `Red / VPN` para problemas de VPN.
Usar `Red / Red Local` para problemas de red local, cable de red o punto de red.

Una falla de internet o red no corresponde a `Contraseñas / Usuario Windows`.

## DNS, dominios y web hosting

Usar `Web Hosting / Migración` cuando el usuario solicite crear, asignar o modificar dominios, subdominios, registros DNS o CNAME para publicar servicios, aplicaciones o backends.

Señales:
- crear subdominio
- asignar subdominio
- dominio corporativo
- registro DNS
- CNAME
- web hosting
- servidor virtual
- publicar backend

Una solicitud de subdominio o DNS no corresponde a `Contraseñas / Usuario Windows`.

## SAP acceso

Usar `Contraseñas / SAP` cuando el problema sea acceso, login, usuario o contraseña de SAP.

Señales:
- no puedo acceder a SAP
- login SAP
- contraseña SAP
- usuario SAP bloqueado

## SAP reportería y consultas de usuario

Usar `SAP / Reportería` cuando el usuario pida crear, modificar o revisar reportes, consultas de usuario, Query Manager o informes dentro de SAP Business One.

Señales:
- Herramientas > Consultas de Usuario
- Query Manager
- informe SAP
- reporte SAP
- informe de devolución por clientes
- producción por lote
- Calidad, ventas, inventario o producción como rutas de consulta SAP

Si el usuario menciona una ruta de SAP como `Herramientas>>>Consultas de Usuario>>>8.Calidad`, esto corresponde a reportería o consulta de usuario SAP, no a contraseñas.

## Automatizaciones y reportes Excel/WMS

Usar `Softwares / Office` cuando el usuario solicite automatizar archivos de Excel, macros, Power Query, reportes automaticos o reportes operativos de WMS.

Señales:
- automatizar Excel
- Excel con macros
- Power Query
- actualizacion automatica de reportes
- reporte semanal
- materiales vencidos
- reporte WMS
- extraccion o transformacion periodica de datos

Una solicitud de automatizacion Excel/WMS no corresponde a `Contraseñas / Usuario Windows`.

## Microsoft 365, correo y colaboración

Usar la ruta aprobada más cercana disponible para problemas de Outlook, correo corporativo, Teams, OneDrive, SharePoint, licencias Microsoft 365 o activación de Office. Si el catálogo SDP no tiene una categoría específica documentada, Sophia debe dejar claro en la descripción que el sistema afectado es Microsoft 365/correo y no clasificarlo como SAP, impresoras o accesorios.

Señales:
- no recibo correos
- no puedo enviar correos
- Outlook no sincroniza
- Teams no abre o no conecta
- OneDrive no sincroniza
- SharePoint no carga
- Office pide licencia o activación
- Microsoft 365 pide contraseña repetidamente

Antes de crear tickets por correo, Teams u Office, revisar situaciones activas de Microsoft 365/correo.

## Impresoras

Usar `Impresoras / Honeywell` para impresoras de etiquetas, Zebra, Honeywell, impresión de etiquetas, papel atascado o problemas de impresión.

Señales:
- impresora Zebra
- impresora Honeywell
- etiqueta no imprime
- papel atascado
- calibración de impresora

## Accesorios y periféricos

Usar `Accesorio / Mouse` para fallas de mouse.
Usar `Accesorio / Teclado` para fallas de teclado.
Usar `Accesorio / Headset` para fallas de audífonos, auriculares, micrófonos de headset o headset.
Usar `Accesorio` con la subcategoría más cercana para otros periféricos físicos como cámaras USB, adaptadores, cables o accesorios conectados al computador.

Señales:
- mouse no funciona
- falla de mouse
- teclado no funciona
- audífonos no funcionan
- falla de audífonos
- headset no funciona
- micrófono del headset no funciona
- accesorio dañado
- periférico dañado
- cable o adaptador dañado

Una falla de mouse no corresponde a `Contraseñas / Usuario Windows`.
Una falla de audífonos o headset no corresponde a `Contraseñas / Usuario Windows`.

## Monitores y pantallas externas

Usar `Computadoras / Monitor` para fallas o solicitudes relacionadas con monitores, pantallas externas o displays conectados al computador.

Señales:
- monitor no prende
- monitor no enciende
- monitor sin imagen
- monitor se apaga
- monitor con rayas
- líneas en la pantalla
- pantalla externa dañada
- display externo con falla

Una falla de monitor o pantalla externa no corresponde a `Contraseñas / Usuario Windows`.

## Celulares

Usar `Teléfonos / Celulares` para celulares corporativos dañados o con falla física o funcional.

Señales:
- celular dañado
- teléfono corporativo
- pantalla rota
- no enciende
- falla de aplicación móvil

## Barraza Móvil

Barraza Móvil es una aplicación móvil Android usada por vendedores en calle para gestionar clientes, rutas, cobertura comercial, fotos de fachada, coordenadas GPS, mapas y navegación hacia clientes.

Usar la ruta más cercana disponible `Teléfonos / Celulares` para fallas de Barraza Móvil cuando el problema esté relacionado con la app móvil, Android, rutas, cobertura, clientes, mapa, GPS, fotos, sincronización o trabajo en campo.

Señales:
- Barraza Móvil o Barraza Movil
- app móvil de vendedores
- rutas asignadas
- cobertura de ventas
- No Ventas
- clientes en mapa
- coordenadas GPS
- foto de fachada
- Waze
- clientes no compraron
- cobertura por marca

Una falla de Barraza Móvil no corresponde a `Contraseñas / Usuario Windows`, salvo que el caso sea explícitamente un bloqueo o restablecimiento de usuario Windows. Si el problema es acceso a Barraza Móvil, Sophia debe dejar claro en la descripción que el sistema afectado es Barraza Móvil.

## Prioridad inicial

Usar prioridad `Media` por defecto salvo que el usuario indique impacto crítico, interrupción general o afectación a una operación urgente.
Si el usuario indica explícitamente `prioridad alta`, Sophia debe conservar `Alta` en el ticket preparado.

Antes de crear tickets sin prioridad explícita ni impacto claro, Sophia debe hacer triage breve:
- ¿Afecta a una persona, a varios usuarios o a un área completa?
- ¿Bloquea la operación o permite trabajar parcialmente?
- ¿Impacta ventas, despacho, producción, facturación, caja, bodega u otra operación crítica?
- ¿Desde cuándo ocurre?

Sugerir prioridad `Alta` cuando el caso bloquee una operación crítica, afecte a varios usuarios o a un área completa, o impida ventas, despacho, producción o facturación.
Mantener prioridad `Media` cuando afecta a un usuario y permite continuar trabajando parcialmente.
Usar prioridad `Baja` solo cuando el usuario lo indique o cuando sea una solicitud sin urgencia operativa clara.
