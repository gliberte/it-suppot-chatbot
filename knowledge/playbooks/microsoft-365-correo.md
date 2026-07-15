---
title: Playbook de diagnóstico - Microsoft 365 y correo
doc_type: playbook
area: soporte
visibility: all
---

# Microsoft 365 y correo

Usar este playbook para Outlook, correo corporativo, Microsoft 365, Teams, OneDrive, SharePoint, licencias, envío/recepción de correos y acceso a aplicaciones de Microsoft.

## Situación activa primero

Antes de crear tickets por correo, Teams o Microsoft 365, Sophia debe revisar si existe una situación activa relacionada. Si hay una situación activa, debe informarla y evitar tickets duplicados salvo que el usuario necesite constancia o el síntoma sea distinto.

## Antes de crear ticket

Si falta contexto, Sophia debe preguntar máximo dos o tres datos:

- Aplicación afectada: Outlook, Teams, OneDrive, SharePoint, Office, correo web u otra.
- Síntoma principal: no abre, no sincroniza, no envía, no recibe, pide contraseña, licencia, error específico.
- Alcance: solo el usuario, varios usuarios o un área completa.
- Desde cuándo ocurre y si está dentro de la red corporativa o fuera.

## Clasificación sugerida

Si existe categoría específica para Microsoft 365 o correo, usarla. Si el catálogo SDP aún no tiene ruta específica documentada, Sophia debe:

- evitar clasificarlo como SAP o impresoras;
- usar la ruta aprobada más cercana disponible;
- explicar en la descripción que el sistema afectado es Microsoft 365/correo.

## Patrones frecuentes

- `No recibo correos`, `no puedo enviar`, `Outlook no sincroniza`: correo/Outlook.
- `Teams no abre`, `Teams no conecta`, `no puedo entrar a reunión`: Teams/Microsoft 365.
- `OneDrive no sincroniza`, `archivo no sube`: OneDrive/SharePoint.
- `Pide licencia`, `producto sin activar`: licencia Microsoft 365.
- `Pide contraseña repetidamente`: puede ser credenciales, perfil Outlook o autenticación.

## Descripción útil

Debe incluir aplicación afectada, síntoma, mensaje de error, alcance, hora aproximada, pruebas realizadas y si ocurre en web, escritorio o móvil.

## Qué evitar

- No pedir contraseñas ni códigos MFA.
- No afirmar caída general sin situación activa o evidencia.
- No crear múltiples tickets para la misma caída general si IT ya registró situación activa.
