import { Pool, type PoolClient } from 'pg';
import { env } from './env';

/**
 * Pool de conexiones único para toda la aplicación. `pg` maneja el
 * reciclado y la cola de conexiones internamente; no crear más de un Pool.
 */
export const pool = new Pool({
  host: env.pg.host,
  port: env.pg.port,
  database: env.pg.database,
  user: env.pg.user,
  password: env.pg.password,
  max: env.pg.poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // Errores en clientes idle del pool (ej. conexión cortada por el server).
  // No deben tirar abajo el proceso.
  console.error('[db] Error inesperado en cliente idle del pool', err);
});

export async function checkDbConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

/**
 * Ejecuta `fn` dentro de una transacción (BEGIN/COMMIT/ROLLBACK),
 * garantizando la liberación del cliente al pool en todos los casos.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
