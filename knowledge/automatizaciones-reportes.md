# Automatizaciones y reportes operativos

## Clasificacion general

Cuando el usuario solicite automatizar archivos, reportes, consultas o procesos de datos, Sophia debe tratarlo como un requerimiento de automatizacion/reportes, no como un caso de contrasenas o usuario Windows.

Aplica para solicitudes como:

- automatizacion de Excel
- macros
- Power Query
- actualizacion automatica de reportes
- reportes WMS
- materiales vencidos
- extraccion periodica de datos
- transformacion de datos
- consolidacion de informacion
- reportes semanales o diarios
- generacion automatica de archivos
- consultas operativas recurrentes

## Regla de clasificacion

Si el caso menciona Excel, macros, WMS, reportes automaticos o actualizacion periodica de informacion, Sophia debe evitar clasificarlo como:

- `Contrasenas / Usuario Windows`

Ruta sugerida inicial:

- Categoria: `Softwares`
- Subcategoria: `Office`

Si ServiceDesk Plus tiene una categoria mas especifica para automatizaciones, desarrollo o integraciones, Sophia debe usar esa ruta configurada y dejar evidencia en la descripcion.

Prioridad tipica:

- Media

Subir prioridad solo si el usuario indica impacto directo en produccion, calidad, despacho, facturacion, ventas o cierre operativo.

## Preguntas recomendadas

Antes de crear el ticket, Sophia debe procurar reunir:

- El reporte ya existe o hay que crearlo desde cero.
- Fuente de datos.
- Si el origen es WMS, SAP, Excel, base de datos u otro sistema.
- Frecuencia de actualizacion.
- Responsable funcional del reporte.
- Area que lo usara.
- Columnas, filtros o calculos obligatorios.
- Si el archivo debe enviarse por correo, guardarse en una carpeta o actualizarse en una ubicacion compartida.
- Fecha limite o cierre operativo asociado.

## Ejemplo

Usuario:

> Necesito un Excel que se actualice automaticamente cada lunes con el reporte semanal de materiales vencidos de WMS, agregando o quitando lineas segun corresponda.

Sophia debe entender:

- Tipo de caso: automatizacion de reporte operativo.
- Sistema relacionado: WMS.
- Herramienta: Excel.
- Frecuencia: semanal.
- Impacto probable: calidad u operacion.
- Prioridad inicial: Media, salvo que el usuario indique bloqueo operativo.

Sophia debe responder preparando un ticket con clasificacion de automatizacion/reportes u Office, no con `Contrasenas / Usuario Windows`.

## Redaccion sugerida del ticket

Asunto:

> Automatizacion de reporte Excel para materiales vencidos de WMS

Descripcion:

> Se solicita automatizar un archivo de Excel para actualizar periodicamente el reporte de materiales vencidos de WMS. El archivo debe agregar o quitar lineas segun el reporte semanal disponible. Se requiere confirmar fuente de datos, frecuencia exacta, responsable funcional, ubicacion del archivo y columnas obligatorias.

## Senales de baja confianza

Si Sophia no encuentra una ruta clara en el catalogo SDP para automatizaciones/reportes, debe:

- informar que la clasificacion requiere validacion
- evitar usar una ruta por defecto de contrasenas
- preguntar por el sistema relacionado y el area impactada
- sugerir prioridad Media mientras no exista evidencia de bloqueo operativo
