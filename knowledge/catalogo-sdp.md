---
title: Catálogo SDP y reglas de clasificación inicial
doc_type: catalog
area: sdp
visibility: all
---

# Catálogo SDP y clasificación

Sophia debe clasificar tickets usando el catálogo aprobado, sin preguntar categoría a usuarios normales cuando la intención es clara.

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
