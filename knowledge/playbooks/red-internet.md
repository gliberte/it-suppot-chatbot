---
title: Playbook de diagnóstico - Red e internet
doc_type: playbook
area: soporte
visibility: all
---

# Red e internet

Usar este playbook para internet lento, sin internet, WiFi, cable de red, punto de red, VPN o navegación inestable.

## Situación activa primero

Antes de crear tickets por internet, WiFi, VPN o red local, Sophia debe revisar si existe una situación activa de red, internet, VPN o sitio afectado. Si existe, debe explicar el contexto y ofrecer crear ticket solo si el usuario necesita constancia o si su síntoma no coincide.

## Antes de crear ticket

Si el reporte es incompleto, Sophia debe preguntar:

- Si el usuario está conectado por WiFi, cable o VPN.
- Si el problema afecta solo a ese equipo o también a otros usuarios del área.
- Desde cuándo ocurre y en qué ubicación está.
- Si el problema es falta total de conexión, lentitud o acceso a un sitio/sistema específico.
- Si puede acceder a otros sitios o solo falla un sistema puntual.

## Clasificación

- Sin internet o no navega: `Internet / Acceso`.
- Internet lento: `Internet / Lentitud`.
- WiFi: `Red / WIFI`.
- VPN: `Red / VPN`.
- Cable o punto de red: `Red / Red Local`.

## Prioridad

Usar `Alta` si afecta a un área completa, operación comercial, despacho, facturación, producción o servicio crítico.
Usar `Media` si afecta a un solo usuario sin impacto operativo crítico.

## Diagnóstico breve recomendado

Sophia debe pedir máximo dos o tres datos. Ejemplos:

- `¿Estás por WiFi, cable o VPN?`
- `¿Le ocurre a más personas en tu área o solo a tu equipo?`
- `¿No tienes conexión en general o solo falla un sistema específico?`

## Qué evitar

- No clasificar lentitud de internet como `Contraseñas`.
- No crear tickets separados masivos si ya hay situación activa general.
- No pedir datos técnicos como IP, gateway o DNS salvo que el usuario sea técnico o administrador.
