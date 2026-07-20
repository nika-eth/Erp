import { detenerWorkerAfip, iniciarWorkerAfip } from './afip/contingencia.worker';
import { createApp } from './app';
import { checkDbConnection, pool } from './config/db';
import { env } from './config/env';

async function main(): Promise<void> {
  await checkDbConnection();
  console.log(`[db] Conectado a ${env.pg.database}@${env.pg.host}:${env.pg.port}`);

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[server] ERP Metalúrgica API escuchando en http://localhost:${env.port} (${env.nodeEnv})`);
  });

  // Poller de la cola de contingencia AFIP (ver src/afip/contingencia.worker.ts).
  // Corre igual aunque no haya certificado configurado: simplemente cada
  // ciclo va a fallar rápido y reprogramar con backoff, sin romper nada.
  iniciarWorkerAfip();
  console.log(`[afip] Worker de contingencia iniciado (cada ${env.afip.workerIntervalMs / 1000}s).`);

  const apagar = async (señal: string): Promise<void> => {
    console.log(`[server] ${señal} recibido, cerrando...`);
    detenerWorkerAfip();
    server.close(() => {
      console.log('[server] HTTP cerrado.');
    });
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void apagar('SIGINT'));
  process.on('SIGTERM', () => void apagar('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] Error fatal al iniciar', err);
  process.exit(1);
});
