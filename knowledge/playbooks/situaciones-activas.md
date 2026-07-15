---
title: Playbook operativo - Situaciones activas de IT
doc_type: playbook
area: soporte
visibility: all
---

# Situaciones activas de IT

Las situaciones activas son conocimiento operativo temporal registrado por el departamento IT para incidentes, degradaciones o comportamientos anómalos recientes.

No sustituyen los tickets ni el RAG permanente. Sirven para que Sophia responda con contexto vivo cuando un usuario pregunta si ocurre algo con un sistema o reporta un síntoma que coincide con una situación conocida.

## Cuándo usar situaciones activas

Sophia debe consultar o mencionar situaciones activas cuando el usuario pregunte:

- `¿Ocurre algo con SAP?`
- `¿SAP está caído?`
- `No puedo entrar a SAP`
- `¿Hay problemas con Internet?`
- `Teams está fallando?`
- `No recibo correos`

Si hay situación activa relacionada, Sophia debe informar primero el contexto antes de crear tickets duplicados.

## Comandos para administradores

Registrar:

`Sophia, registra situación activa de SAP: intermitencia de acceso desde las 8:30 AM. Impacta Finanzas y Bodega. Prioridad alta.`

Actualizar:

`Sophia, actualiza situación de SAP: BASIS está revisando conectividad. Se mantiene intermitente.`

Cerrar:

`Sophia, cierra situación de SAP: servicio normalizado.`

Listar:

`Sophia, muestra las situaciones activas.`

## Respuesta recomendada para usuarios

Si hay coincidencia:

`Sí, hay una situación activa relacionada con SAP. IT reportó intermitencia de acceso desde las 8:30 AM. Si tu error coincide, puedo revisar si ya tienes un ticket relacionado o crear uno asociado si necesitas constancia.`

Si no hay coincidencia:

`No tengo registrada una situación activa para SAP en este momento. Si me compartes el error exacto, reviso si hay tickets relacionados o preparo una solicitud.`

## Buenas prácticas

- Mantener mensajes breves y útiles.
- No decir que un sistema está caído si la situación solo indica intermitencia.
- No crear tickets duplicados si el usuario solo quiere saber el estado.
- Ofrecer crear ticket asociado si el usuario necesita trazabilidad formal.
- Cerrar situaciones cuando el servicio se normalice.

## Datos útiles al registrar

- Sistema afectado.
- Estado: Activo, Intermitente, No disponible, En monitoreo, Resuelto.
- Severidad: Alta, Media o Baja.
- Impacto o áreas afectadas.
- Hora de inicio aproximada.
- Acción en curso.
- Vigencia esperada.
