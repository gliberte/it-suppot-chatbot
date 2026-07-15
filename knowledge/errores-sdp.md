---
title: Errores frecuentes de ServiceDesk Plus y correcciones internas
doc_type: troubleshooting
area: sdp
visibility: admin
---

# Errores frecuentes de ServiceDesk Plus

Este documento enseña a Sophia cómo interpretar errores comunes de SDP sin trasladar campos internos al usuario final.

## Regla general

Cuando ServiceDesk Plus rechaza una acción por campos internos, Sophia debe explicar que se trata de un ajuste interno de clasificación o configuración. No debe pedir al usuario nombres de campos como `udf_pick_*`, IDs internos, payloads o valores técnicos.

Sophia debe:

- reconocer el fallo sin culpar al usuario;
- no afirmar que la acción se ejecutó si SDP la rechazó;
- sugerir reintentar solo cuando la configuración interna esté corregida;
- registrar el error en auditoría;
- mantener una respuesta breve y humana.

## `udf_pick_2701` obligatorio

Error típico:

```text
Please fill the mandatory fields ["udf_pick_2701"]
```

Significado:

`udf_pick_2701` es el campo custom `Técnico asignado` en ServiceDesk Plus.

Corrección:

Sophia debe completar `udf_pick_2701` desde la regla de clasificación, la ruta SDP o `SDP_DEFAULT_UDF_PICK_2701`.

Respuesta correcta al usuario:

`No pude crear la solicitud porque ServiceDesk Plus rechazó un campo interno obligatorio de asignación. No es un dato que debas proporcionarme; necesito que corrijamos la ruta interna de asignación y luego lo intento de nuevo.`

Qué evitar:

- No pedir al usuario `udf_pick_2701`.
- No pedir "tipo de activo" o "ubicación" si el error real fue técnico asignado.
- No inventar un técnico.

## `udf_pick_2701` inválido

Error típico:

```text
Invalid Input field udf_pick_2701
```

Significado:

El valor enviado para `Técnico asignado` no existe, no es válido para esa plantilla o no coincide con el catálogo de SDP.

Corrección:

- Validar el valor configurado para la categoría/subcategoría.
- Usar exactamente el nombre o valor aceptado por SDP.
- Revisar la ruta de clasificación antes de reintentar.

## Subcategoría obligatoria

Error típico:

```text
Please fill the mandatory fields ["subcategory"]
```

Significado:

La categoría requiere una subcategoría válida.

Corrección:

Sophia debe resolver la subcategoría desde el catálogo SDP:

- Mouse: `Accesorio / Mouse`
- Teclado: `Accesorio / Teclado`
- Headset o audífonos: `Accesorio / Headset`
- Monitor: `Computadoras / Monitor`
- Celular corporativo: `Teléfonos / Celulares`
- Zebra/Honeywell/etiquetas: `Impresoras / Honeywell`

Qué evitar:

- No enviar `Accesorio` sin subcategoría cuando el accesorio está claro.
- No pedir al usuario que elija una subcategoría interna.

## Subcategoría inválida

Error típico:

```text
Invalid Input field subcategory
```

Significado:

La subcategoría no pertenece a la categoría elegida o no existe con ese nombre exacto en SDP.

Corrección:

Sophia debe corregir la ruta categoría/subcategoría. Ejemplos:

- Falla de mouse: `Accesorio / Mouse`, no `Contraseñas / Usuario Windows`.
- Audífonos o headset: `Accesorio / Headset`.
- Monitor con líneas: `Computadoras / Monitor`.
- Solicitud de subdominio: `Web Hosting / Migración`.

## Notas o seguimientos

Para agregar seguimientos a tickets, Sophia debe usar `sdp_add_note` con:

```json
{
  "request_id": "13466",
  "note_text": "texto del seguimiento"
}
```

Qué evitar:

- No usar `sdp_update_request` con `fields.notes`.
- No enviar campos extra como `text` si el MCP espera `note.description`.
- No afirmar éxito si luego no puede verificar que la nota aparece en SDP.

## MCI

Para modificar MCI, Sophia debe usar `sdp_update_mci`, no `sdp_update_request`.

Si aparece:

```text
Herramienta no encontrada: sdp_update_mci
```

Significa que el MCP de SDP no está actualizado o no fue compilado/desplegado con la herramienta MCI.

Corrección:

- Actualizar `/opt/sophia/sdp-mcp-server`.
- Ejecutar `npm run build` en el MCP.
- Reiniciar Sophia para que reconecte al MCP actualizado.

## Respuesta recomendada ante error confirmado

Sophia debe responder:

`No pude completar la acción porque ServiceDesk Plus rechazó un campo interno de configuración. Ya tengo claro qué parte falló; no necesito que me des datos técnicos. Lo correcto es ajustar la ruta interna y reintentar.`

Debe evitar:

- respuestas vagas como `hubo un problema técnico`;
- pedir datos al usuario que no corresponden;
- decir que "sigo intentando" sin una acción concreta.
