---
title: Playbook de soporte - Barraza Movil
doc_type: playbook
area: soporte
visibility: all
---

# Barraza Movil

Barraza Movil es una app movil en Android que usan los vendedores en calle para gestionar clientes, rutas, cobertura comercial y datos de campo.

La app permite:

- Crear clientes nuevos.
- Actualizar informacion de clientes.
- Enviar actualizaciones de foto de fachada.
- Capturar o corregir coordenadas de localizacion GPS.
- Reportar cierres, incidencias o datos operativos de clientes.
- Consultar clientes, coberturas o acciones frecuentes con asistencia integrada tipo Sophia AI.

## Valor para vendedores

Barraza Movil le da al vendedor una vista practica de su operacion diaria en campo.

Le sirve para:

- Ver sus rutas asignadas y consultar los clientes que debe atender.
- Revisar la cobertura de ventas: cuantos clientes de una ruta ya compraron, cuantos faltan y el porcentaje de avance.
- Filtrar cobertura por marca de producto, por ejemplo Spum, Sip o Americano.
- Consultar la lista de No Ventas, es decir, clientes que aun no han comprado en la ruta o marca seleccionada.
- Ver clientes en el mapa y ubicarlos geograficamente para planificar visitas.
- Navegar hacia clientes usando herramientas como Waze cuando tienen coordenadas.
- Trabajar con rutas guardadas localmente cuando la conectividad es limitada.

En resumen: la app ayuda al vendedor a saber donde ir, a quien visitar, quien falta por comprar y que tan bien va su cobertura, tanto general como por marca.

Para la empresa, Barraza Movil mejora el control de cobertura, la calidad de datos y el seguimiento comercial en campo.

## Diagnostico antes de crear ticket

Si un usuario reporta problemas con Barraza Movil, Sophia debe identificar primero el tipo de caso:

- Acceso: no puede iniciar sesion, usuario bloqueado, credenciales, permisos.
- Sincronizacion o datos: no ve rutas, clientes, cobertura, No Ventas o marcas.
- Ubicacion: GPS, coordenadas, mapa, Waze o precision de localizacion.
- Fotos o evidencia: no puede subir foto de fachada o adjuntos.
- Rendimiento: app lenta, se cierra, no carga o se queda congelada.
- Conectividad: funciona en WiFi pero no en datos, o falla en campo con baja senal.
- Operacion comercial: dudas sobre rutas asignadas, cobertura por marca, clientes pendientes o avance.

Preguntas utiles:

- ¿El problema es de acceso, rutas/cobertura, clientes, mapa/GPS, fotos o rendimiento?
- ¿Ocurre solo a un vendedor o a varios vendedores?
- ¿La app muestra algun mensaje de error?
- ¿Funciona con WiFi o datos moviles?
- ¿Desde cuando ocurre?

## Clasificacion sugerida

Para fallas de la app Barraza Movil en Android, usar la ruta mas cercana disponible:

- Categoria: `Teléfonos`
- Subcategoria: `Celulares`

Si el caso es claramente una solicitud de acceso o contraseña, Sophia debe describir que el sistema afectado es Barraza Movil, pero no debe clasificarlo como SAP ni como impresoras.

## Prioridad

Usar prioridad `Alta` cuando:

- Afecta a varios vendedores o una ruta completa.
- Bloquea ventas, cobertura comercial, captura de clientes o gestion en campo.
- Impide registrar clientes, actualizar coordenadas o completar visitas relevantes.

Usar prioridad `Media` cuando:

- Afecta a un solo usuario.
- El vendedor puede continuar parcialmente.
- El caso es consulta, correccion menor o problema no bloqueante.
