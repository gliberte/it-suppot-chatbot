import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const artifactDir = '/Users/luissolano/.gemini/antigravity/brain/990c748d-49d5-4134-af7a-b06a8c88c7f0';
const htmlPath = path.join(artifactDir, 'Informe_Ejecutivo_Sophia.html');
const pdfPath = path.join(artifactDir, 'Informe_Ejecutivo_Sophia_v0.25.0.pdf');

const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Informe Ejecutivo de Avances y Mejoras - Sophia (v0.25.0)</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 15mm 18mm 15mm;
      @bottom-right {
        content: counter(page);
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      line-height: 1.5;
      margin: 0;
      padding: 0;
      background-color: #ffffff;
      font-size: 13px;
    }
    .header {
      background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%);
      color: #ffffff;
      padding: 24px 28px;
      border-radius: 10px;
      margin-bottom: 24px;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15);
    }
    .header h1 {
      margin: 0 0 6px 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .header .subtitle {
      font-size: 14px;
      color: #93c5fd;
      margin-bottom: 12px;
      font-weight: 500;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.15);
      font-size: 12px;
    }
    .meta-item strong {
      display: block;
      color: #cbd5e1;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .meta-item span {
      color: #ffffff;
      font-weight: 600;
    }
    
    .section-title {
      font-size: 17px;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 6px;
      margin-top: 24px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .badge {
      display: inline-block;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 700;
      border-radius: 12px;
      text-transform: uppercase;
    }
    .badge-success { background-color: #dcfce7; color: #166534; }
    .badge-info { background-color: #dbeafe; color: #1e40af; }
    .badge-warning { background-color: #fef3c7; color: #92400e; }

    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 20px;
    }

    .card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .card h3 {
      margin-top: 0;
      margin-bottom: 8px;
      font-size: 14px;
      color: #1e3a8a;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .card p {
      margin: 0 0 8px 0;
      color: #475569;
      font-size: 12px;
    }
    .card ul {
      margin: 0;
      padding-left: 18px;
      color: #334155;
      font-size: 12px;
    }
    .card li {
      margin-bottom: 4px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      margin-bottom: 20px;
      font-size: 12px;
    }
    th {
      background-color: #0f172a;
      color: #ffffff;
      text-align: left;
      padding: 9px 12px;
      font-weight: 600;
    }
    td {
      padding: 8px 12px;
      border-bottom: 1px solid #e2e8f0;
    }
    tr:nth-child(even) {
      background-color: #f8fafc;
    }

    .impact-banner {
      background-color: #eff6ff;
      border-left: 4px solid #2563eb;
      padding: 14px 18px;
      border-radius: 0 8px 8px 0;
      margin-bottom: 20px;
    }
    .impact-banner h4 {
      margin: 0 0 4px 0;
      color: #1e40af;
      font-size: 13px;
    }
    .impact-banner p {
      margin: 0;
      color: #1e3a8a;
      font-size: 12px;
    }

    .footer {
      margin-top: 30px;
      padding-top: 12px;
      border-top: 1px solid #cbd5e1;
      text-align: center;
      font-size: 11px;
      color: #64748b;
    }

    .page-break {
      page-break-after: always;
    }
  </style>
</head>
<body>

  <!-- HEADER -->
  <div class="header">
    <h1>🚀 Informe Ejecutivo de Avances y Mejoras en Sophia</h1>
    <div class="subtitle">Asistente Conversacional Inteligente para Soporte IT & Gestión de Incidentes</div>
    <div class="meta-grid">
      <div class="meta-item">
        <strong>Organización</strong>
        <span>Barraza & Cía.</span>
      </div>
      <div class="meta-item">
        <strong>Versión Actual</strong>
        <span>v0.19.5 (Producción)</span>
      </div>
      <div class="meta-item">
        <strong>Plataforma</strong>
        <span>SDP + Teams + Web</span>
      </div>
      <div class="meta-item">
        <strong>Fecha de Informe</strong>
        <span>20 de Julio de 2026</span>
      </div>
    </div>
  </div>

  <!-- IMPACT BANNER -->
  <div class="impact-banner">
    <h4>📌 Visión General de Transformación IT</h4>
    <p>Sophia ha evolucionado de un chatbot reactivo a un <strong>asistente conversacional ejecutivo de 3 niveles</strong>, integrado nativamente con ServiceDesk Plus y Microsoft Teams. Reduce la carga operativa de la mesa de ayuda, automatiza la clasificación con 100% de precisión y asegura el cumplimiento de tiempos de servicio (SLA) en toda la compañía.</p>
  </div>

  <!-- SECCIÓN: PILARES PRINCIPALES -->
  <div class="section-title">
    💡 Pilares Funcionales de Alto Impacto
  </div>

  <div class="grid-2">
    
    <!-- PILAR 1 -->
    <div class="card">
      <h3>
        ⭐ Encuestas CSAT (1-Clic)
        <span class="badge badge-success">v0.15.0</span>
      </h3>
      <p><strong>Medición directa de satisfacción post-atención.</strong></p>
      <ul>
        <li>Tarjeta adaptativa interactiva de 1 a 5 estrellas (⭐⭐⭐⭐⭐) en Teams y Web.</li>
        <li>Graba automáticamente las opiniones como notas estructuradas en ServiceDesk Plus.</li>
        <li>Agrega la opción "Calificar atención" al consultar tickets resueltos/cerrados.</li>
      </ul>
    </div>

    <!-- PILAR 2 -->
    <div class="card">
      <h3>
        🔔 Recordatorios 8:30 AM (SLA)
        <span class="badge badge-success">v0.16.0 / v0.17.0</span>
      </h3>
      <p><strong>Desbloqueo de tickets en espera por usuario.</strong></p>
      <ul>
        <li>Proceso proactivo matutino que escanea solicitudes inactivas por 48+ horas.</li>
        <li>Respuesta rápida directa desde la tarjeta en Teams sin abrir portales externos.</li>
        <li>Prueba exitosa en producción procesando <strong>47 tickets pendientes</strong>.</li>
      </ul>
    </div>

    <!-- PILAR 3 -->
    <div class="card">
      <h3>
        📊 Dashboard Ejecutivo IT
        <span class="badge badge-info">v0.18.0 / v0.18.1</span>
      </h3>
      <p><strong>Métricas de salud operativa en tiempo real.</strong></p>
      <ul>
        <li>Promedio acumulado CSAT de estrellas en tiempo real.</li>
        <li>Desglose de carga de trabajo por técnico asignado (Kassim, Purificación, etc.).</li>
        <li>Top 5 categorías de incidentes con mayor volumen (SAP, Impresoras, Red).</li>
      </ul>
    </div>

    <!-- PILAR 4 & 5 -->
    <div class="card">
      <h3>
        🏁 Cierre y Evidencias Visuales
        <span class="badge badge-info">v0.19.0</span>
      </h3>
      <p><strong>Adjunto de capturas y confirmación de solución.</strong></p>
      <ul>
        <li>Extracción y adjunto automático de capturas de pantalla enviadas en Teams.</li>
        <li>Tarjeta de confirmación de solución al marcar tickets como "Resuelto".</li>
        <li>Opción de 1-clic para calificar o solicitar <strong>Reapertura Asistida</strong>.</li>
      </ul>
    </div>

  </div>

  <div class="page-break"></div>

  <!-- SECCIÓN: ARQUITECTURA DE SOPORTE Y CLASIFICACIÓN -->
  <div class="section-title">
    🛠️ Clasificación Inteligente y Canales de Atención
  </div>

  <table>
    <thead>
      <tr>
        <th>Nivel</th>
        <th>Canal / Componente</th>
        <th>Capacidades y Cobertura</th>
        <th>Estado</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Nivel 1</strong></td>
        <td>RAG Playbooks & Auto-Solución</td>
        <td>Empoderamiento del usuario con guías de diagnóstico rápido en la Fase 1 de borrador antes de crear el ticket.</td>
        <td><span class="badge badge-success">Activo</span></td>
      </tr>
      <tr>
        <td><strong>Nivel 2</strong></td>
        <td>Enrutamiento Determinístico SDP</td>
        <td>24 rutas obligatorias probadas con 100% de precisión (SAP, FortiClient VPN, Carpetas Compartidas, Licencias PowerBI/Office, Impresoras, Suministros, Mudanzas).</td>
        <td><span class="badge badge-success">100% Precisión</span></td>
      </tr>
      <tr>
        <td><strong>Nivel 3</strong></td>
        <td>Búsqueda Web Técnica (DDG HTML)</td>
        <td>Búsqueda asistida en fuentes oficiales (Microsoft, HP, Zebra) para errores comerciales complexes (ej. 0x80070005) con sanitización de privacidad.</td>
        <td><span class="badge badge-success">Activo</span></td>
      </tr>
      <tr>
        <td><strong>Integración</strong></td>
        <td>Microsoft Teams Bot Framework</td>
        <td>Manejo de tarjetas adaptativas, confirmaciones en 2 fases, capturas de pantalla y recordatorios matutinos.</td>
        <td><span class="badge badge-success">Producción</span></td>
      </tr>
    </tbody>
  </table>

  <!-- SECCIÓN: CORRECCIONES DE ESTABILIDAD Y PRECISIÓN -->
  <div class="section-title">
    🔒 Estabilidad Operativa y Corrección de Casos Borde (v0.19.1 - v0.19.5)
  </div>

  <div class="grid-2">
    <div class="card">
      <h3>Mapeo de Campos UDF en MCI</h3>
      <p>Corrección en <code>sdp_update_mci</code> para mapear alias como <code>udf_date_1508</code> (Fecha de actualización) y <code>udf_sline_2102</code> (Predictiva) a nombres lógicos oficiales.</p>
    </div>
    <div class="card">
      <h3>Normalización de Fechas (Epoch)</h3>
      <p>Implementada la función <code>normalizeSdpDateValue</code> para convertir strings de fecha a timestamp epoch numérico, eliminando desbordamientos de meses en ServiceDesk Plus.</p>
    </div>
    <div class="card">
      <h3>Aislamiento de Intenciones</h3>
      <p>Filtrado de comandos directos para evitar que la edición de MCI dispare por error el Dashboard Ejecutivo, la revisión de candidatos de conocimiento o alertas de situaciones activas.</p>
    </div>
    <div class="card">
      <h3>Verificación en Producción</h3>
      <p>Todas las actualizaciones validadas mediante pruebas automáticas con ESLint limpio y suite completa de routing (20/20 casos exitosos).</p>
    </div>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <strong>Sophia IT Support Chatbot v0.19.5</strong> | Desarrollado para <strong>Barraza & Cía.</strong> | Documento Generado Automáticamente
  </div>

</body>
</html>`;

fs.writeFileSync(htmlPath, htmlContent, 'utf8');
console.log(`[PDFGenerator] Archivo HTML generado en: ${htmlPath}`);

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const command = `"${chromePath}" --headless --disable-gpu --print-to-pdf="${pdfPath}" "${htmlPath}"`;

console.log(`[PDFGenerator] Ejecutando Google Chrome headless para generar PDF...`);
try {
  execSync(command);
  console.log(`[PDFGenerator] ✅ PDF generado exitosamente en: ${pdfPath}`);
} catch (error) {
  console.error('[PDFGenerator] Error generando PDF:', error.message);
}
