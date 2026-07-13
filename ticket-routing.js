export function normalizeRoutingText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveTicketRoutingFromText(input, env = process.env) {
  const subject = typeof input === 'string' ? input : input?.subject;
  const description = typeof input === 'string' ? '' : input?.description;
  const text = normalizeRoutingText(`${subject || ''} ${description || ''}`);
  const routingMap = getTicketRoutingMap(env);
  const match = routingMap
    .map((route) => ({
      route,
      matchedKeywords: route.keywords.filter((keyword) => text.includes(normalizeRoutingText(keyword)))
    }))
    .find((candidate) => candidate.matchedKeywords.length > 0);

  return match ? { ...match.route, matchedKeywords: match.matchedKeywords } : {};
}

export function getTicketRoutingMap(env = process.env) {
  const fallback = [
    {
      name: 'sap_access',
      keywords: ['no puedo acceder a sap', 'acceso a sap', 'entrar a sap', 'login sap', 'contraseña sap', 'password sap', 'usuario o contraseña'],
      category: env.SDP_SAP_ACCESS_CATEGORY || env.SDP_PASSWORD_CATEGORY || env.SDP_DEFAULT_CATEGORY || 'Contraseñas',
      subcategory: env.SDP_SAP_ACCESS_SUBCATEGORY || 'SAP',
      priority: env.SDP_SAP_ACCESS_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_SAP_ACCESS_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'sap_reporting',
      keywords: [
        'consultas de usuario',
        'query manager',
        'informe de devolución',
        'informe de devolucion',
        'producción por lote',
        'produccion por lote',
        'reportería',
        'reporteria',
        'reporte sap',
        'informe sap'
      ],
      category: env.SDP_SAP_REPORT_CATEGORY || env.SDP_SAP_CATEGORY || 'SAP',
      subcategory: env.SDP_SAP_REPORT_SUBCATEGORY || 'Reportería',
      priority: env.SDP_SAP_REPORT_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_SAP_REPORT_UDF_PICK_2701 || env.SDP_SAP_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'sap',
      keywords: ['sap', 'business one', 'b1'],
      category: env.SDP_SAP_CATEGORY || 'SAP',
      subcategory: env.SDP_SAP_SUBCATEGORY || 'Problemas en Modulos',
      priority: env.SDP_SAP_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_SAP_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'web_hosting_dns',
      keywords: [
        'subdominio',
        'sub dominio',
        'dominio',
        'dns',
        'cname',
        'registro dns',
        'web hosting',
        'publicacion de backend',
        'publicación de backend',
        'servidor virtual'
      ],
      category: env.SDP_WEB_HOSTING_CATEGORY || 'Web Hosting',
      subcategory: env.SDP_WEB_HOSTING_SUBCATEGORY || 'Migración',
      priority: env.SDP_WEB_HOSTING_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_WEB_HOSTING_UDF_PICK_2701 || env.SDP_NETWORK_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'internet_slow',
      keywords: [
        'internet lento',
        'internet lentitud',
        'lentitud internet',
        'lentitud de internet',
        'internet muy lento',
        'internet con lentitud',
        'navegación lenta',
        'navegacion lenta'
      ],
      category: env.SDP_INTERNET_CATEGORY || 'Internet',
      subcategory: env.SDP_INTERNET_SLOW_SUBCATEGORY || 'Lentitud',
      priority: env.SDP_INTERNET_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_NETWORK_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'internet_access',
      keywords: ['no tengo internet', 'sin internet', 'internet no funciona', 'no hay internet', 'conexión a internet', 'conexion a internet', 'internet'],
      category: env.SDP_INTERNET_CATEGORY || 'Internet',
      subcategory: env.SDP_INTERNET_ACCESS_SUBCATEGORY || 'Acceso',
      priority: env.SDP_INTERNET_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_NETWORK_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'network_wifi',
      keywords: ['wifi', 'wi-fi', 'inalámbrico', 'inalambrico'],
      category: env.SDP_NETWORK_CATEGORY || 'Red',
      subcategory: env.SDP_WIFI_SUBCATEGORY || 'WIFI',
      priority: env.SDP_NETWORK_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_NETWORK_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'network_vpn',
      keywords: ['vpn'],
      category: env.SDP_NETWORK_CATEGORY || 'Red',
      subcategory: env.SDP_VPN_SUBCATEGORY || 'VPN',
      priority: env.SDP_NETWORK_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_NETWORK_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'network_local',
      keywords: ['red local', 'red', 'cable de red', 'punto de red'],
      category: env.SDP_NETWORK_CATEGORY || 'Red',
      subcategory: env.SDP_NETWORK_LOCAL_SUBCATEGORY || 'Red Local',
      priority: env.SDP_NETWORK_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_NETWORK_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'printer',
      keywords: ['impresora', 'imprimir', 'etiqueta', 'zebra', 'printer'],
      category: env.SDP_PRINTER_CATEGORY || env.SDP_DEFAULT_CATEGORY || 'Contraseñas',
      subcategory: env.SDP_PRINTER_SUBCATEGORY || 'Honeywell',
      priority: env.SDP_PRINTER_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_PRINTER_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'peripheral_mouse',
      keywords: ['mouse', 'raton', 'ratón'],
      category: env.SDP_PERIPHERAL_CATEGORY || 'Accesorio',
      subcategory: env.SDP_MOUSE_SUBCATEGORY || 'Mouse',
      priority: env.SDP_PERIPHERAL_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_PERIPHERAL_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'peripheral_keyboard',
      keywords: ['teclado', 'keyboard'],
      category: env.SDP_PERIPHERAL_CATEGORY || 'Accesorio',
      subcategory: env.SDP_KEYBOARD_SUBCATEGORY || 'Teclado',
      priority: env.SDP_PERIPHERAL_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_PERIPHERAL_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'peripheral_audio',
      keywords: ['audifono', 'audífono', 'audifonos', 'audífonos', 'headset'],
      category: env.SDP_PERIPHERAL_CATEGORY || 'Accesorio',
      subcategory: env.SDP_AUDIO_SUBCATEGORY || 'Headset',
      priority: env.SDP_PERIPHERAL_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_PERIPHERAL_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'computer_monitor',
      keywords: [
        'monitor',
        'monitores',
        'pantalla externa',
        'display externo',
        'lineas en la pantalla',
        'líneas en la pantalla',
        'rayas en la pantalla',
        'monitor no prende',
        'monitor no enciende',
        'monitor sin imagen',
        'pantalla sin imagen'
      ],
      category: env.SDP_COMPUTER_CATEGORY || 'Computadoras',
      subcategory: env.SDP_MONITOR_SUBCATEGORY || 'Monitor',
      priority: env.SDP_COMPUTER_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_COMPUTER_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'peripheral',
      keywords: ['periferico', 'periférico', 'accesorio', 'camara usb', 'cámara usb', 'adaptador', 'cable hdmi', 'cable usb'],
      category: env.SDP_PERIPHERAL_CATEGORY || 'Accesorio',
      subcategory: env.SDP_PERIPHERAL_SUBCATEGORY || env.SDP_MOUSE_SUBCATEGORY || 'Mouse',
      priority: env.SDP_PERIPHERAL_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_PERIPHERAL_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'mobile_device',
      keywords: [
        'celular',
        'teléfono',
        'telefono',
        'móvil',
        'movil',
        'smartphone',
        'iphone',
        'android',
        'equipo dañado',
        'equipo danado',
        'pantalla quebrada',
        'pantalla rota',
        'se dañó',
        'se dano',
        'se daño'
      ],
      category: env.SDP_MOBILE_CATEGORY || env.SDP_DEVICE_CATEGORY || 'Teléfonos',
      subcategory: env.SDP_MOBILE_SUBCATEGORY || env.SDP_DEVICE_SUBCATEGORY || 'Celulares',
      priority: env.SDP_MOBILE_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_MOBILE_UDF_PICK_2701 || env.SDP_DEVICE_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    },
    {
      name: 'password',
      keywords: ['contraseña', 'clave', 'password', 'bloqueada', 'bloqueado', 'usuario o contraseña'],
      category: env.SDP_PASSWORD_CATEGORY || env.SDP_DEFAULT_CATEGORY || 'Contraseñas',
      subcategory: env.SDP_PASSWORD_SUBCATEGORY || env.SDP_DEFAULT_SUBCATEGORY || 'Usuario Windows',
      priority: env.SDP_PASSWORD_PRIORITY || env.SDP_DEFAULT_PRIORITY || 'Media',
      udf_pick_2701: env.SDP_PASSWORD_UDF_PICK_2701 || env.SDP_DEFAULT_UDF_PICK_2701 || 'Kassim Acevedo'
    }
  ];

  if (!env.SDP_TICKET_ROUTING_MAP) return fallback;

  try {
    const configured = JSON.parse(env.SDP_TICKET_ROUTING_MAP);
    return Array.isArray(configured) ? configured : fallback;
  } catch (error) {
    console.warn('[Routing] SDP_TICKET_ROUTING_MAP no es JSON válido:', error.message);
    return fallback;
  }
}
