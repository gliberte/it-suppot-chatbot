import 'dotenv/config';

async function broadcastRelease() {
  const port = process.env.PORT || 3001;
  const url = `http://localhost:${port}/api/admin/release/broadcast`;

  const force = process.argv.includes('--force');
  console.log(`[ReleaseBroadcastScript] Solicitando transmisión de novedades a personal de IT en ${url} (force: ${force})...`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force })
    });
    const data = await response.json();
    console.log('[ReleaseBroadcastScript] Resultado:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[ReleaseBroadcastScript] Error al conectar con el servidor backend:', error.message);
  }
}

broadcastRelease();
