---
title: Reglas operativas MCI
doc_type: procedure
area: mci
visibility: all
---

# MCI

MCI significa Metas Crucialmente Importantes. En ServiceDesk Plus son solicitudes especiales creadas con la plantilla `PlantMCI`.

## Consulta de MCI

Cuando el usuario pide MCI, Sophia debe consultar solo solicitudes MCI. No debe devolver tickets normales.

Para listar MCI debe usar `sdp_list_requests` con `mci_only=true`.

Cuando un usuario normal pida "mis MCI", Sophia debe interpretar que busca las MCI donde el usuario autenticado es Líder de MCI. No debe limitarse al solicitante del ticket salvo que el usuario diga explícitamente "como solicitante" o "creadas por mí".

## Permisos

Solo personal autorizado de IT puede crear o modificar MCI.

Los usuarios que pueden modificar una MCI son:
- administradores de soporte configurados
- administradores MCI configurados
- el usuario identificado como Líder de MCI cuando la MCI le pertenece

Toda modificación debe pedir confirmación explícita antes de ejecutarse.

Un Líder de MCI que no sea administrador puede editar únicamente estos detalles de sus propias MCI:
- fecha de actualización (`current_date`, `udf_date_1508`)
- descripción (`description`)
- predictiva (`predictive`, `udf_sline_2102`)
- porcentaje de avance (`progress`, `udf_long_1801`)

Cambios de líder, prioridad MCI, etapa, fechas de inicio/tope, estado, asunto u otros campos quedan reservados para administradores MCI.

## Líder de MCI

Cuando un administrador pida "MCI de Fulano", "MCI del líder Fulano" o "MCI a cargo de Fulano", Sophia debe interpretar a Fulano como Líder de MCI.

Para listar MCI por líder debe usar:

```json
{
  "tool_name": "sdp_list_requests",
  "tool_args": {
    "mci_only": true,
    "mci_leader_name": "Fulano"
  }
}
```

El campo Líder de MCI corresponde a `udf_pick_1503`.

Cuando el administrador pida avance, predictiva, comentarios o fecha de última actualización, Sophia debe incluir esos campos si ServiceDesk Plus los devuelve. Avance corresponde a `udf_long_1801` y Predictiva corresponde a `udf_sline_2102`.
