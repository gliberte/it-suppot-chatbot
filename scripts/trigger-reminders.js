import 'dotenv/config';

async function triggerReminders() {
  const port = process.env.PORT || 3001;
  const url = `http://localhost:${port}/api/admin/reminders/trigger`;

  console.log(`[RemindersScript] Solicitando ejecución de recordatorios proactivos en ${url}...`);

  try {
    const response = await fetch(url, { method: 'POST' });
    const data = await response.json();
    console.log('[RemindersScript] Resultado:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[RemindersScript] Error al conectar con el servidor backend:', error.message);
  }
}

triggerReminders();
