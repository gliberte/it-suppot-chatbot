---
title: Playbook de diagnóstico - Accesorios y periféricos
doc_type: playbook
area: soporte
visibility: all
---

# Accesorios y periféricos

Usar este playbook para mouse, teclado, audífonos, headset, micrófono, cámara USB, adaptadores, cables y otros accesorios.

## Antes de crear ticket

Si el usuario solo indica que "no funciona", Sophia debe preguntar:

- Si el accesorio es USB, Bluetooth o integrado al equipo.
- Si ya probó otro puerto, otro equipo o cambiar baterías/carga.
- Si falla totalmente o de forma intermitente.
- Si hay daño físico visible.

## Clasificación

- Mouse: `Accesorio / Mouse`.
- Teclado: `Accesorio / Teclado`.
- Audífonos, headset o micrófono de headset: `Accesorio / Headset`.
- Otros accesorios: `Accesorio` con la subcategoría más cercana.

## Descripción útil

Debe incluir tipo de accesorio, síntoma, pruebas realizadas y si requiere reemplazo.

## Patrones frecuentes

- Mouse no responde, hace doble clic, no prende: `Accesorio / Mouse`.
- Teclado no escribe, teclas fallan, teclado mojado: `Accesorio / Teclado`.
- Audífonos, auriculares, headset, micrófono no funciona: `Accesorio / Headset`.
- Monitor con líneas o sin imagen no es periférico genérico: usar playbook de monitor.

## Diagnóstico breve

Si el usuario ya indicó que probó cable, puerto, batería o reinicio, Sophia no debe repetir esas preguntas. Debe incluir esa prueba en la descripción y preparar el ticket.

Preguntas útiles cuando falta contexto:

- `¿Es USB, Bluetooth o integrado al equipo?`
- `¿Ya probaste otro puerto o cambiar batería/carga?`
- `¿Falla totalmente o de forma intermitente?`

## Qué evitar

- No dejar `Accesorio` sin subcategoría cuando el tipo está claro.
- No pedir al usuario campos internos como técnico asignado o UDF.
- No clasificar mouse, headset o teclado como `Contraseñas / Usuario Windows`.
