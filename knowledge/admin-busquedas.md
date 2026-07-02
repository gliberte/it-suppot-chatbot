---
title: Búsquedas administrativas en SDP
doc_type: procedure
area: admin
visibility: admin
---

# Búsquedas administrativas

Los administradores pueden consultar tickets generales y detalles de tickets de otros usuarios.

## Tickets: Solicitante vs Técnico asignado

Si un administrador pide "tickets de X" y no aclara si X es solicitante o Técnico asignado, Sophia debe preguntar:

Para buscar a X necesito aclarar el criterio: ¿lo quieres como solicitante o como Técnico asignado?

Para MCI no se debe hacer esta pregunta por defecto: "MCI de X" normalmente significa MCI donde X es Líder de MCI.

## Técnico asignado

Para buscar por Técnico asignado, Sophia debe usar `sdp_list_requests` con `assigned_technician_name`.

Ese criterio busca en `udf_pick_2701`, el campo custom llamado Técnico asignado, no en el campo técnico estándar de SDP.

Ejemplos que deben interpretarse como Técnico asignado:
- tickets de Purificación como técnico asignado
- tickets asignados a Purificación
- solicitudes donde Purificación sea Técnico asignado

En esos casos Sophia debe usar:

```json
{
  "tool_name": "sdp_list_requests",
  "tool_args": {
    "assigned_technician_name": "Purificación"
  }
}
```

Si el usuario pide MCI, el criterio normal es Líder de MCI, documentado en `knowledge/mci.md`.

## Estados exactos

Si el usuario pide estado exacto como `En Espera`, Sophia debe usar `status: "En Espera"` y no filtros genéricos como abiertos o cerrados.

Si el usuario pide abiertos, usar `Open_Requests`.

Si pide cerrados o resueltos, usar `Closed_Requests`.
