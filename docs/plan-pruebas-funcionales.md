# Plan De Pruebas Funcionales Sophia

Este plan valida el comportamiento funcional de Sophia en Teams y puede reutilizarse en pruebas locales controladas. El objetivo es comprobar seguridad, ruteo SDP, formato de respuestas, MCI, confirmaciones y experiencia conversacional.

## Preparacion

Antes de iniciar:

```bash
cd /opt/sophia/it-support-chatbot
npm run prod:version
npm run prod:check
```

Durante las pruebas, monitorear:

```bash
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log
```

```bash
sudo journalctl -u sophia -f
```

Si ya hay actividad Teams:

```bash
tail -f teams-audit.log audit.log sdp-debug.log
```

Resultado minimo esperado antes de pruebas Teams:

- `sophia.service` activo.
- `nginx` activo.
- `HTTPS local via Nginx` en `200`.
- `Teams messages route` en `401 esperado sin firma Bot Framework`.
- Azure Bot configurado con `https://sophia.barrazaycia.com/api/teams/messages`.

## Criterios Generales

Cada respuesta debe cumplir:

- tono humano, profesional y breve;
- no debe inventar datos de SDP;
- debe pedir aclaracion cuando el criterio sea ambiguo;
- debe usar tablas o tarjetas legibles para resultados estructurados;
- debe ofrecer siguientes acciones segun el contexto;
- acciones mutantes deben pedir confirmacion mediante botones o confirmacion explicita;
- usuarios normales no deben consultar datos de otros usuarios salvo conocimiento sanitizado permitido;
- administradores pueden consultar informacion general segun rol configurado.

## Matriz De Casos

| ID | Rol | Prompt | Resultado esperado | Logs esperados |
| --- | --- | --- | --- | --- |
| T-001 | Usuario | `hola` | Sophia saluda, reconoce al usuario y ofrece acciones utiles. | `message_received`, `reply_sent` |
| T-002 | Usuario | `cual es el estado de mis tickets` | Lista solo tickets del solicitante autenticado, con tabla legible y opciones de seguimiento. | llamada SDP de listado, `reply_sent` |
| T-003 | Usuario | `muestrame el detalle del ticket <ticket-propio>` | Tarjeta clara con estado, prioridad, categoria, tecnico, fechas, descripcion y opciones. | ownership permitido |
| T-004 | Usuario | `muestrame el detalle del ticket <ticket-ajeno>` | Bloquea detalle completo; si aplica, ofrece version sanitizada solo si es caso resuelto/cerrado. | `authorization_denied` o respuesta sanitizada |
| T-005 | Usuario | `crea un ticket porque mi mouse no funciona, prioridad media` | Prepara ticket `Accesorio / Mouse`, prioridad `Media`, pide confirmacion. | `confirmation_required` |
| T-006 | Usuario | Confirmar T-005 | Crea ticket en SDP y muestra numero/resultado claro. | `confirmed_success` |
| T-007 | Usuario | `crea un ticket porque mis audifonos no funcionan` | Clasifica como `Accesorio / Headset`, no como contraseñas. | `confirmation_required` |
| T-008 | Usuario | `crea un ticket por celular corporativo dañado` | Clasifica como `Teléfonos / Celulares`. | `confirmation_required` |
| T-009 | Usuario | `crear ticket por internet lento` | Clasifica como `Internet / Lentitud`. | `confirmation_required` |
| T-010 | Usuario | `no puedo acceder a SAP` | Clasifica como `Contraseñas / SAP`. | `confirmation_required` |
| T-011 | Usuario | `necesito modificar una consulta de usuario SAP para informe de devolucion por clientes y produccion por lote` | Clasifica como `SAP / Reportería`, no `Contraseñas / Usuario Windows`. | `confirmation_required` |
| T-012 | Usuario | `necesito crear el subdominio sophia.bacosa.com para un servidor virtual, prioridad alta` | Clasifica como `Web Hosting / Migración`, prioridad `Alta`. | `confirmation_required` |
| T-013 | Usuario | Cancelar una solicitud preparada | No crea ticket y confirma cancelacion. | `confirmation_cancelled` |
| T-014 | Usuario | Confirmar una accion expirada | Informa que la confirmacion expiro y pide iniciar de nuevo. | `confirmation_expired` |

## Casos Administrativos

| ID | Rol | Prompt | Resultado esperado | Logs esperados |
| --- | --- | --- | --- | --- |
| A-001 | Admin | `dime los tickets de Purificacion` | Sophia pide aclarar si Purificacion es solicitante o Técnico asignado. | sin llamada SDP hasta aclarar |
| A-002 | Admin | `tickets abiertos asignados a Purificacion` | Busca por `assigned_technician_name` usando campo `udf_pick_2701`; no usa tecnico estandar. | llamada `sdp_list_requests` |
| A-003 | Admin | `tickets en estado En Espera de Purificacion como tecnico asignado` | Filtra exactamente `status: "En Espera"` y tecnico asignado; no devuelve todos. | llamada SDP con estado exacto |
| A-004 | Admin | `tickets cerrados de Enrique como solicitante` | Busca cerrados/resueltos del solicitante indicado. | llamada SDP filtrada |
| A-005 | Admin | `muestrame detalle del ticket <ticket-ajeno>` | Permite detalle por rol admin, con formato claro. | `reply_sent` |
| A-006 | Admin | `buscar tickets abiertos de impresoras` | Devuelve tabla acotada, no texto plano dificil de leer. | llamada SDP filtrada |

## Casos MCI

| ID | Rol | Prompt | Resultado esperado | Logs esperados |
| --- | --- | --- | --- | --- |
| M-001 | Usuario lider | `muestrame mis MCI` | Busca MCI donde el usuario sea Líder de MCI; no tickets normales. | `mci_only=true` |
| M-002 | Admin | `muestrame las MCI de Kassim Acevedo` | Interpreta Kassim como Líder de MCI; incluye avance, predictiva, comentarios y ultima actualizacion si existen. | `mci_leader_name` |
| M-003 | Admin | `detalle de la MCI 12781` | Muestra tarjeta MCI, no tarjeta de ticket regular. | detalle SDP MCI |
| M-004 | Usuario lider | `actualiza el avance de mi MCI 12781 a 40%` | Si es lider de esa MCI, prepara cambio de avance y pide confirmacion. | `confirmation_required` |
| M-005 | Usuario lider | Confirmar M-004 | Actualiza `udf_long_1801`, responde con tarjeta MCI actualizada. | `confirmed_success` |
| M-006 | Usuario lider | `actualiza la predictiva de mi MCI 12781 a En riesgo por dependencia de proveedor` | Permite cambio si es lider autorizado y pide confirmacion. | `confirmation_required` |
| M-007 | Usuario no lider | `actualiza la MCI 12781 a 80%` | Niega modificacion si no es lider ni admin MCI. | `authorization_denied` |
| M-008 | Admin MCI | `actualiza la fecha actual de la MCI 12781 a hoy` | Muestra fecha humana en confirmacion, no timestamp ilegible. | `confirmation_required` |

## Formato Y Experiencia

| ID | Rol | Prompt | Resultado esperado |
| --- | --- | --- | --- |
| F-001 | Usuario | `muestrame mis tickets abiertos` | Tabla con encabezados visibles, filas distinguibles y campos utiles. |
| F-002 | Usuario | `detalle del ticket <ticket-propio>` | Tarjeta con secciones claras, no tabla pegada en una linea. |
| F-003 | Admin | `muestrame las MCI de <lider>` | Tabla o tarjetas MCI con avance, predictiva, ultima actualizacion y estado. |
| F-004 | Usuario | `gracias` | Respuesta natural, breve, ofrece ayuda adicional sin sonar mecanica. |
| F-005 | Usuario | pregunta ambigua | Pide aclaracion concreta en vez de usar defaults inseguros. |

## Pruebas De Resiliencia

| ID | Escenario | Resultado esperado |
| --- | --- | --- |
| R-001 | SDP timeout durante busqueda | Sophia informa problema temporal, sugiere reintentar o acotar busqueda. |
| R-002 | SDP devuelve categoria/subcategoria invalida en creacion | Sophia no confirma exito falso; registra error y sugiere revisar catalogo. |
| R-003 | Graph no resuelve usuario | Sophia informa que no puede vincular Teams con SDP y muestra datos necesarios sin exponer secretos. |
| R-004 | Usuario envia confirmacion sin accion pendiente | Sophia indica que no hay accion pendiente y sugiere iniciar la solicitud. |
| R-005 | Reinicio Sophia con accion pendiente | Si la accion no expiro, debe sobrevivir por `runtime-state.json`; si expiro, debe explicarlo. |

## Evidencia A Guardar

Para cada sesion de prueba guardar:

- fecha y hora;
- usuario/rol;
- prompt enviado;
- respuesta visible de Sophia;
- numero de ticket/MCI si aplica;
- resultado esperado vs resultado obtenido;
- extracto de `teams-audit.log`;
- extracto de `audit.log` para tool calls;
- captura si hay problema de formato.

## Comandos De Cierre

Al terminar una ronda:

```bash
npm run prod:check
npm run audit:created-tickets -- --since <ISO-INICIO-DE-PRUEBA>
```

Si hubo cambios de conocimiento RAG:

```bash
npm run rag:ingest
npm run rag:test
```

## Resultado De La Ronda

| Fecha | Ambiente | Probador | Resultado general | Incidencias abiertas |
| --- | --- | --- | --- | --- |
| | | | | |
