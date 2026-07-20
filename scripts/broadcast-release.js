import 'dotenv/config';

async function broadcastRelease() {
  const port = process.env.PORT || 3001;
  const force = process.argv.includes('--force');
  const primaryUrl = `http://127.0.0.1:${port}/api/admin/release/broadcast`;
  const fallbackUrl = `http://localhost:${port}/api/admin/release/broadcast`;

  console.log(`[ReleaseBroadcastScript] Solicitando transmisión de novedades a personal de IT (force: ${force})...`);

  try {
    const response = await fetch(primaryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force })
    });
    const data = await response.json();
    console.log('[ReleaseBroadcastScript] Resultado:', JSON.stringify(data, null, 2));
  } catch (error) {
    try {
      const response = await fetch(fallbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force })
      });
      const data = await response.json();
      console.log('[ReleaseBroadcastScript] Resultado:', JSON.stringify(data, null, 2));
    } catch (fallbackErr) {
      console.error('[ReleaseBroadcastScript] Error al conectar con el servidor backend:', error.message);
      console.error('[ReleaseBroadcastScript] Verifica que el servicio esté corriendo con "npm run pm2:status" o "npm run pm2:restart".');
    }
  }
}

broadcastRelease();
