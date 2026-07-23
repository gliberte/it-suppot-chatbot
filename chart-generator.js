import { createCanvas } from 'canvas';
import { Chart, registerables } from 'chart.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

Chart.register(...registerables);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHARTS_DIR = path.join(__dirname, 'public', 'exports', 'charts');

// Asegura que el directorio exista
try {
  fs.mkdirSync(CHARTS_DIR, { recursive: true });
} catch (err) {
  console.error('[Chart Generator] Error creando directorio de gráficos:', err.message);
}

/**
 * Genera una imagen de gráfico a partir de una configuración de Chart.js y la guarda localmente.
 * Retorna la URL pública del gráfico.
 * 
 * @param {Object} chartConfig - Configuración nativa de Chart.js (type, data, options)
 * @param {string} prefix - Prefijo del archivo (ej: 'mci', 'tickets')
 * @returns {Promise<string>} URL pública de la imagen
 */
export async function generateChartImage(chartConfig, prefix = 'chart') {
  const width = 800;
  const height = 450;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Forzar opciones de renderizado estático
  if (!chartConfig.options) chartConfig.options = {};
  chartConfig.options.responsive = false;
  chartConfig.options.animation = false;
  chartConfig.options.devicePixelRatio = 1;

  // Estilo de fuentes y colores premium por defecto
  if (!chartConfig.options.plugins) chartConfig.options.plugins = {};
  if (!chartConfig.options.plugins.title) chartConfig.options.plugins.title = {};
  
  // Configuración de fuentes por defecto en Chart.js v4
  Chart.defaults.font.family = "'Segoe UI', 'Helvetica Neue', 'Arial', sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#333333';

  // Crear la instancia de Chart.js sobre el contexto del Canvas nativo
  const chart = new Chart(ctx, chartConfig);

  // Escribir a disco
  const buffer = canvas.toBuffer('image/png');
  const filename = `${prefix}-${randomUUID().substring(0, 8)}.png`;
  const filePath = path.join(CHARTS_DIR, filename);

  await fs.promises.writeFile(filePath, buffer);

  // Destruir el chart para liberar memoria
  chart.destroy();

  // Construir la URL pública usando la variable de entorno del dominio
  const publicDomain = process.env.PUBLIC_APP_DOMAIN || 'localhost:3001';
  const protocol = publicDomain.startsWith('localhost') ? 'http' : 'https';
  return `${protocol}://${publicDomain}/exports/charts/${filename}`;
}

/**
 * Genera un gráfico de barras con el avance porcentual de cada MCI de un líder.
 * 
 * @param {Array} mciList - Lista de MCIs (tickets con formato MCI)
 * @param {string} leaderName - Nombre del líder
 * @returns {Promise<string|null>} URL pública de la imagen o null si no hay datos
 */
export async function generateMciProgressChart(mciList, leaderName) {
  if (!mciList || mciList.length === 0) return null;

  // Filtrar y ordenar por ID de solicitud
  const sortedMci = [...mciList].sort((a, b) => Number(a.id) - Number(b.id));

  // Extraer etiquetas (Subject truncado) y progreso
  const labels = sortedMci.map(mci => {
    const subject = mci.subject || `MCI #${mci.id}`;
    return subject.length > 25 ? `${subject.substring(0, 22)}...` : subject;
  });

  const progressData = sortedMci.map(mci => {
    // Si progress viene como udf_long_1801 o similar
    const pVal = mci.progress !== undefined ? mci.progress : (mci.udf_fields?.udf_long_1801 || 0);
    return Math.min(100, Math.max(0, Number(pVal) || 0));
  });

  // Generar paleta de colores dinámicos basada en el porcentaje
  // 0-40%: Rojo/Naranja (#FF6B6B), 41-80%: Amarillo/Azul (#4DABF7), 81-100%: Verde (#2B8A3E)
  const backgroundColors = progressData.map(val => {
    if (val >= 80) return '#2B8A3E'; // Verde bosque premium
    if (val >= 40) return '#4DABF7'; // Azul celeste premium
    return '#FF6B6B'; // Rojo suave
  });

  const chartConfig = {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Porcentaje de Avance (%)',
        data: progressData,
        backgroundColor: backgroundColors,
        borderColor: backgroundColors.map(c => c === '#4DABF7' ? '#1971C2' : c),
        borderWidth: 1.5,
        borderRadius: 6,
        barPercentage: 0.55
      }]
    },
    options: {
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: (value) => `${value}%`
          },
          grid: {
            color: '#E9ECEF'
          }
        },
        x: {
          grid: {
            display: false
          }
        }
      },
      plugins: {
        title: {
          display: true,
          text: `Avance de Metas Crucialmente Importantes (MCI) - Líder: ${leaderName}`,
          font: {
            size: 16,
            weight: 'bold'
          },
          padding: { bottom: 15 }
        },
        legend: {
          display: false
        }
      }
    }
  };

  return await generateChartImage(chartConfig, 'mci');
}

/**
 * Genera un gráfico de pastel o barras mostrando la cantidad de tickets activos por técnico.
 * 
 * @param {Array} tickets - Lista de solicitudes activas
 * @returns {Promise<string|null>} URL pública de la imagen o null si no hay datos
 */
export async function generateTechnicianLoadChart(tickets) {
  if (!tickets || tickets.length === 0) return null;

  // Agrupar tickets por técnico asignado
  const loadMap = {};
  tickets.forEach(ticket => {
    let techName = 'Sin Asignar';
    if (ticket.technician && ticket.technician.name) {
      techName = ticket.technician.name;
    } else if (ticket.udf_fields && ticket.udf_fields.udf_pick_2701) {
      // UDF Técnico Asignado por compatibilidad de capa gratuita
      techName = ticket.udf_fields.udf_pick_2701;
    }
    loadMap[techName] = (loadMap[techName] || 0) + 1;
  });

  const labels = Object.keys(loadMap);
  const data = Object.values(loadMap);

  // Paleta de colores armoniosa
  const backgroundColors = [
    '#4C6EF5', '#15AABF', '#40C057', '#FAB005', '#FD7E14', 
    '#FA5252', '#BE4BDB', '#7950F2', '#228BE6', '#12B886'
  ];

  const chartConfig = {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Tickets Asignados',
        data,
        backgroundColor: backgroundColors.slice(0, labels.length),
        borderColor: backgroundColors.slice(0, labels.length),
        borderWidth: 1,
        borderRadius: 4,
        barPercentage: 0.6
      }]
    },
    options: {
      indexAxis: 'y', // Gráfico de barras horizontal para mejor lectura de nombres
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            precision: 0
          },
          grid: {
            color: '#E9ECEF'
          }
        },
        y: {
          grid: {
            display: false
          }
        }
      },
      plugins: {
        title: {
          display: true,
          text: 'Carga de Tickets Activos por Personal Técnico',
          font: {
            size: 16,
            weight: 'bold'
          },
          padding: { bottom: 15 }
        },
        legend: {
          display: false
        }
      }
    }
  };

  return await generateChartImage(chartConfig, 'tech-load');
}

/**
 * Genera un gráfico para datos tabulares de SAP (facturas, notas de crédito, cotizaciones, etc.).
 * 
 * @param {Array} records - Registros parseados de la consulta SAP
 * @param {string} userPrompt - Prompt original del usuario
 * @returns {Promise<string|null>} URL del gráfico generado o null si no se puede graficar
 */
export async function generateSapGenericChart(records, userPrompt = '') {
  if (!records || records.length === 0) return null;

  const sample = records[0];
  const keys = Object.keys(sample);

  // Buscar la clave que contenga valores numéricos para el eje Y
  let numericKey = keys.find(k => {
    const val = Number(sample[k]);
    const lower = k.toLowerCase();
    return (lower.includes('total') || lower.includes('sum') || lower.includes('monto') || lower.includes('quantity') || lower.includes('cantidad') || lower.includes('total')) && !isNaN(val) && val > 0;
  });

  if (!numericKey) {
    numericKey = keys.find(k => {
      const val = Number(sample[k]);
      const lower = k.toLowerCase();
      return !isNaN(val) && val > 0 && lower !== 'id' && !lower.includes('num') && !lower.includes('entry') && !lower.includes('code') && !lower.includes('slp') && !lower.includes('group');
    });
  }

  // Buscar la clave de etiquetas (eje X)
  let labelKey = keys.find(k => {
    const lower = k.toLowerCase();
    return lower.includes('date') || lower.includes('fecha') || lower.includes('name') || lower.includes('nombre') || lower.includes('item') || lower.includes('dscription');
  });

  if (!labelKey) {
    labelKey = keys.find(k => {
      const lower = k.toLowerCase();
      return lower.includes('code') || lower.includes('num');
    });
  }

  if (!labelKey) labelKey = keys[0];
  if (!numericKey) return null; // Sin datos numéricos, no se grafica.

  // Limitar cantidad de filas para legibilidad del gráfico
  const chartRecords = records.slice(0, 15);

  const labels = chartRecords.map(r => {
    let val = r[labelKey] || '';
    if (val && typeof val === 'string' && val.includes(' 00:00:00')) {
      val = val.split(' ')[0]; // Quitar hora redundante en fechas
    }
    return String(val).length > 25 ? `${String(val).substring(0, 22)}...` : String(val);
  });

  const data = chartRecords.map(r => Number(r[numericKey]) || 0);

  // Deducir el título según la consulta del usuario
  let title = 'Análisis de Datos Administrativos SAP';
  const normPrompt = userPrompt.toLowerCase();
  if (normPrompt.includes('compra') || normPrompt.includes('factura') || normPrompt.includes('venta')) {
    title = 'Historial de Compras/Ventas - Facturación';
  } else if (normPrompt.includes('crédito') || normPrompt.includes('credito') || normPrompt.includes('orin')) {
    title = 'Historial de Notas de Crédito SAP';
  } else if (normPrompt.includes('inventario') || normPrompt.includes('stock') || normPrompt.includes('articulo')) {
    title = 'Nivel de Stock / Inventario SAP';
  }

  const chartConfig = {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: `${numericKey}`,
        data,
        backgroundColor: '#4C6EF5',
        borderColor: '#1C7ED6',
        borderWidth: 1.5,
        borderRadius: 4,
        barPercentage: 0.55
      }]
    },
    options: {
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: '#E9ECEF'
          }
        },
        x: {
          grid: {
            display: false
          }
        }
      },
      plugins: {
        title: {
          display: true,
          text: title,
          font: {
            size: 15,
            weight: 'bold'
          },
          padding: { bottom: 10 }
        },
        legend: {
          display: false
        }
      }
    }
  };

  return await generateChartImage(chartConfig, 'sap-data');
}

/**
 * Poda las imágenes de gráficos generadas que tengan más de 24 horas de antigüedad.
 */
export async function pruneOldCharts() {
  try {
    const files = await fs.promises.readdir(CHARTS_DIR);
    const now = Date.now();
    const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 horas
    let prunedCount = 0;

    for (const file of files) {
      if (file === '.gitkeep' || !file.endsWith('.png')) continue;
      const filePath = path.join(CHARTS_DIR, file);
      try {
        const stats = await fs.promises.stat(filePath);
        const age = now - stats.mtimeMs;
        if (age > MAX_AGE_MS) {
          await fs.promises.unlink(filePath);
          prunedCount++;
        }
      } catch (err) {
        console.error(`[Chart Cleanup] Error procesando archivo ${file}:`, err.message);
      }
    }

    if (prunedCount > 0) {
      console.log(`[Chart Cleanup] Se eliminaron ${prunedCount} gráficos obsoletos (más de 24 horas).`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[Chart Cleanup] Error leyendo directorio de gráficos:', err.message);
    }
  }
}

/**
 * Inicializa el planificador de limpieza en segundo plano.
 * Realiza una poda inicial a los 5 segundos y luego cada 4 horas.
 */
export function startChartCleanupScheduler() {
  // Poda inicial después del arranque
  setTimeout(() => {
    pruneOldCharts().catch(err => console.error('[Chart Cleanup] Fallo inicial:', err.message));
  }, 5000);

  // Poda periódica cada 4 horas
  const CLEANUP_INTERVAL_MS = 4 * 60 * 60 * 1000;
  const timer = setInterval(() => {
    pruneOldCharts().catch(err => console.error('[Chart Cleanup] Fallo en intervalo:', err.message));
  }, CLEANUP_INTERVAL_MS);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}


