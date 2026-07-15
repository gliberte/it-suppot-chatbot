---
title: Playbook de diagnóstico - SAP
doc_type: playbook
area: soporte
visibility: all
---

# SAP

Usar este playbook para SAP Business One, acceso SAP, reportes, consultas de usuario, Query Manager o errores de módulo.

## Situación activa primero

Antes de crear tickets por SAP, Sophia debe revisar si existe una situación activa registrada para SAP. Si la hay, debe informar al usuario con claridad y evitar crear tickets duplicados salvo que:

- el error del usuario sea diferente al incidente activo;
- el usuario necesite dejar constancia formal;
- el impacto sea crítico o afecte una operación no cubierta por la situación activa.

Si hay una situación activa, Sophia puede decir:

`Hay una situación activa relacionada con SAP. Si tu error coincide, puedo ayudarte a revisar si ya tienes un ticket relacionado o crear uno asociado si necesitas dejar constancia.`

## Antes de crear ticket

Si falta contexto, Sophia debe preguntar:

- Mensaje de error exacto o pantalla donde falla.
- Módulo, reporte, consulta o ruta dentro de SAP.
- Si afecta solo al usuario o a varios usuarios.
- Si es acceso/login, reporte, permisos o falla funcional.
- Si ocurre dentro de la red corporativa, por VPN o desde otra ubicación.

## Clasificación

- Acceso, login, usuario o contraseña SAP: `Contraseñas / SAP`.
- Reportes, Query Manager o consultas de usuario: `SAP / Reportería`.
- Problemas funcionales en módulos SAP: `SAP / Problemas en Modulos`.

## Patrones frecuentes

- `No puedo entrar a SAP`, `SAP no abre`, `usuario SAP bloqueado`: tratar como acceso SAP.
- `No veo un módulo`, `no tengo permiso`, `no aparece una opción`: tratar como permisos o problema funcional SAP, no como Windows.
- `Modificar reporte`, `consulta de usuario`, `Query Manager`, `Herramientas > Consultas de Usuario`: tratar como reportería SAP.
- `Error al generar informe`, `producción por lote`, `devolución por clientes`: tratar como reportería o módulo SAP según la ruta.

## Descripción útil

Debe incluir ruta o módulo, mensaje exacto, usuario afectado, fecha/hora aproximada e impacto.

## Qué evitar

- No clasificar SAP como `Contraseñas / Usuario Windows` salvo que el error sea claramente de inicio de sesión Windows/AD.
- No pedir contraseña, tokens ni capturas con credenciales visibles.
- No prometer que SAP está caído si no hay situación activa registrada o evidencia del usuario.
