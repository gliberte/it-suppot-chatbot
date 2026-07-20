import 'dotenv/config';

async function triggerReminders() {
  const port = process.env.PORT || 3001;
  const primaryUrl = `http://127.0.0.1:${port}/api/admin/reminders/trigger`;
  const fallbackUrl = `http://localhost:${port}/api/admin/reminders/trigger`;

  console.log('[RemindersScript] Solicitando ejecución de recordatorios proactivos...');

  try {
    const response = await fetch(primaryUrl, { method: 'POST' });
    const data = await response.json();
    console.log('[RemindersScript] Resultado:', JSON.stringify(data, null, 2));
  } catch (error) {
    try {
      const response = await fetch(fallbackUrl, { method: 'POST' });
      const data = await response.json();
      console.log('[RemindersScript] Resultado:', JSON.stringify(data, null, 2));
    } catch (fallbackErr) {
      console.error('[RemindersScript] Error al conectar con el servidor backend:', error.message);
      console.error('[RemindersScript] Verifica que el servicio esté corriendo con "npm run pm2:status" o "npm run pm2:restart".');
    }
  }
}

triggerReminders();
