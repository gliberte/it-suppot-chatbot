# Reporte de Catalogo SDP - 2026-07-01

Consulta realizada contra ServiceDesk Plus API v3 usando la misma configuracion del MCP.

## Rutas validas

| Catalogo | Endpoint recomendado | Clave de respuesta | Resultado |
|---|---|---|---|
| Categorias de solicitudes | `/requests/category` | `category` | 39 categorias |
| Subcategorias de solicitudes | `/requests/subcategory` | `subcategory` | 177 subcategorias |
| Plantillas | `/request_templates` | `request_templates` | 16 plantillas |

Notas:
- `/categories` y `/subcategories` tambien responden, pero para solicitudes es mas preciso usar `/requests/category` y `/requests/subcategory`.
- `/request_categories`, `/request_subcategories`, `/requests/categories` y `/requests/subcategories` devolvieron `Invalid URL`.

## Categorias disponibles

| ID | Categoria |
|---|---|
| 3301 | Accesorio |
| 3006 | Alarmas |
| 3001 | BackUps |
| 2701 | Bases de Datos |
| 5701 | Cableado |
| 603 | Camaras |
| 3007 | Capacitaciones |
| 2 | Computadoras |
| 3003 | Contrasenas |
| 3005 | Control de Acceso |
| 901 | Correo |
| 5401 | Documentacion |
| 4501 | Firewall |
| 3901 | GPS |
| 17 | Impresoras |
| 2102 | Integraciones |
| 7 | Internet |
| 3603 | KPI (solo IT) |
| 302 | LR Sistemas |
| 1801 | Manhattan |
| 602 | Mudanzas |
| 3008 | Pay Day |
| 4801 | PDTs |
| 4201 | Proyectos |
| 6001 | Recursos Compartidos |
| 15 | Red |
| 1201 | Reloj de Marcacion |
| 3004 | RRHH |
| 13 | SAP |
| 3602 | Servicios CLOUD |
| 601 | Servidores |
| 605 | Softwares |
| 301 | Soporte de Aplicaciones GIS |
| 3002 | Suministros |
| 5101 | Tablet |
| 16 | Teléfonos |
| 2101 | UPS |
| 604 | Usuarios |
| 3601 | Web Hosting |

## Ruteos relevantes para Sophia

| Intencion | Categoria | Subcategoria | Observacion |
|---|---|---|---|
| Celular danado / telefono movil | Teléfonos | Celulares | Recomendado para solicitudes como "mi celular se dano". |
| Tablet | Tablet | Configuraciones / Actualizaciones / Correo / WMS | Elegir segun texto del usuario. |
| Laptop / PC | Computadoras | Laptop / PC | Para danos o fallas de equipo de computo. |
| Monitor | Computadoras | Monitor | Para pantalla/monitor externo. |
| Impresoras Zebra | Impresoras | Zebra Etiquetas | Mejor opcion que Honeywell cuando el texto dice Zebra. |
| Impresoras Honeywell | Impresoras | Honeywell | Mantener para Honeywell. |
| Internet | Internet | Acceso / Lentitud | Usar Acceso si no hay conexion; Lentitud si el usuario reporta lentitud. |
| Red / WiFi / VPN | Red | WIFI / VPN / Red Local | Elegir segun texto. |
| SAP | SAP | Problemas en Modulos | Ruta actual correcta para problemas funcionales SAP. |
| Acceso SAP | Contrasenas | SAP | Ruta actual correcta para credenciales/acceso SAP. |
| Usuario Windows | Contrasenas | Usuario Windows | Solo para claves/bloqueos de Windows. |

## Candidatos moviles encontrados

| ID | Categoria | Subcategoria |
|---|---|---|
| 34 | Teléfonos | Celulares |
| 304 | Teléfonos | Lineas Fijas |
| 7501 | Tablet | WMS |
| 7502 | Tablet | Correo |
| 7503 | Tablet | Actualizaciones |
| 7504 | Tablet | Configuraciones |
| 5402 | Computadoras | Tablet |
| 3610 | Accesorio | Tablets |

## Plantillas disponibles

| ID | Plantilla |
|---|---|
| 4 | Default Request |
| 5 | Default Service Item |
| 17 | Request a Laptop |
| 18 | Request a new Desktop |
| 10 | Request RAM upgrade |
| 3 | Printer problem |
| 55 | Keyboard problem |
| 56 | Monitor display problem |
| 57 | Unable to remote to a PC |
| 58 | PC does not boot |
| 59 | Mouse not working |
| 60 | Wireless connection not working |
| 604 | PlantMCI |

## Cambios aplicados

- Sophia ahora enruta celulares danados a `Teléfonos / Celulares`.
- `.env` actualizado:
  - `SDP_MOBILE_CATEGORY=Teléfonos`
  - `SDP_MOBILE_SUBCATEGORY=Celulares`
  - `SDP_MOBILE_PRIORITY=Media`
- MCP `sdp_get_catalogs` actualizado para consultar las rutas correctas y soportar claves singulares/plurales.

## Siguiente recomendacion

Agregar ruteos mas especificos para:
- Zebra: `Impresoras / Zebra Etiquetas`
- Internet sin conexion: `Internet / Acceso`
- Internet lento: `Internet / Lentitud`
- Laptop/PC danada: `Computadoras / Laptop` o `Computadoras / PC`
