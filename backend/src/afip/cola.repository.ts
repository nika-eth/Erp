import type { PoolClient } from 'pg';
import { pool } from '../config/db';
import type { EstadoServicioAfip, TareaColaAfip, TipoDocumentoCliente } from '../types/domain';
import type { ResultadoSolicitudCae } from './types';

/** Backoff exponencial simple, tope 30 min, para no bombardear a AFIP mientras está caído. */
export function calcularProximoReintento(reintentos: number): Date {
  const minutos = Math.min(30, 2 ** reintentos);
  return new Date(Date.now() + minutos * 60_000);
}

/** Encola un documento en CONTINGENCIA para que el worker lo sincronice. Idempotente por `id_documento`. */
export async function encolarContingencia(client: PoolClient, id_documento: number): Promise<void> {
  await client.query(
    `INSERT INTO cola_facturacion_afip (id_documento, estado, proximo_reintento)
     VALUES ($1, 'PENDIENTE', NOW())
     ON CONFLICT (id_documento) DO UPDATE SET estado = 'PENDIENTE', proximo_reintento = NOW()`,
    [id_documento],
  );
}

export interface TareaConDocumento extends TareaColaAfip {
  punto_venta: number;
  tipo_comprobante: number;
  nro_comprobante_afip: number | null;
  total_neto: string;
  tipo_documento_cliente: TipoDocumentoCliente;
  numero_documento: string;
}

/** Toma hasta `limite` tareas vencidas y las marca PROCESANDO en el mismo golpe (`FOR UPDATE SKIP LOCKED`), para permitir más de una instancia del worker sin duplicar trabajo. */
export async function tomarTareasPendientes(limite = 10): Promise<TareaConDocumento[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<TareaConDocumento>(
      `SELECT t.id_tarea, t.id_documento, t.reintentos, t.proximo_reintento, t.estado, t.ultimo_error,
              ca.punto_venta, ca.tipo_comprobante, ca.nro_comprobante_afip, d.total_neto,
              cl.tipo_documento AS tipo_documento_cliente, cl.numero_documento
       FROM cola_facturacion_afip t
       JOIN documentos d ON d.id_documento = t.id_documento
       JOIN comprobantes_afip ca ON ca.id_documento = t.id_documento
       JOIN clientes cl ON cl.id_cliente = d.cliente_id
       WHERE t.estado = 'PENDIENTE' AND t.proximo_reintento <= NOW()
       ORDER BY t.proximo_reintento
       LIMIT $1
       FOR UPDATE OF t SKIP LOCKED`,
      [limite],
    );
    if (rows.length > 0) {
      await client.query(
        `UPDATE cola_facturacion_afip SET estado = 'PROCESANDO', actualizado_en = NOW() WHERE id_tarea = ANY($1::int[])`,
        [rows.map((r) => r.id_tarea)],
      );
    }
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Toma una tarea puntual por id, sin importar `proximo_reintento` (usado por el reintento manual desde administración). */
export async function tomarTareaPorId(id_tarea: number): Promise<TareaConDocumento | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<TareaConDocumento>(
      `SELECT t.id_tarea, t.id_documento, t.reintentos, t.proximo_reintento, t.estado, t.ultimo_error,
              ca.punto_venta, ca.tipo_comprobante, ca.nro_comprobante_afip, d.total_neto,
              cl.tipo_documento AS tipo_documento_cliente, cl.numero_documento
       FROM cola_facturacion_afip t
       JOIN documentos d ON d.id_documento = t.id_documento
       JOIN comprobantes_afip ca ON ca.id_documento = t.id_documento
       JOIN clientes cl ON cl.id_cliente = d.cliente_id
       WHERE t.id_tarea = $1 AND t.estado = 'PENDIENTE'
       FOR UPDATE OF t`,
      [id_tarea],
    );
    if (rows.length > 0) {
      await client.query(
        `UPDATE cola_facturacion_afip SET estado = 'PROCESANDO', actualizado_en = NOW() WHERE id_tarea = $1`,
        [id_tarea],
      );
    }
    await client.query('COMMIT');
    return rows[0] ?? null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Aplica el resultado de un intento (exitoso o no) de CAE tanto al documento
 * fiscal como a la tarea de la cola, dentro de una misma transacción:
 *   - `ok: true`               -> documento APROBADO con CAE; tarea COMPLETADO.
 *   - `ok: false, RECHAZADO`   -> documento RECHAZADO; tarea FALLIDO (rechazo
 *     de negocio validado por AFIP, no se reintenta solo, requiere revisión).
 *   - `ok: false, CONTINGENCIA` -> documento sigue en CONTINGENCIA con el
 *     mensaje de error actualizado; tarea reprogramada con backoff, o FALLIDO
 *     si ya se agotaron los reintentos configurados.
 */
export async function aplicarResultadoTarea(
  client: PoolClient,
  id_tarea: number,
  id_documento: number,
  reintentosPrevios: number,
  maxReintentos: number,
  resultado: ResultadoSolicitudCae,
): Promise<void> {
  if (resultado.ok) {
    await client.query(
      `UPDATE comprobantes_afip SET cae = $1, cae_vencimiento = $2, estado_afip = 'APROBADO', error_afip_mensaje = NULL
       WHERE id_documento = $3`,
      [resultado.cae, resultado.caeVencimiento, id_documento],
    );
    await client.query(
      `UPDATE cola_facturacion_afip SET estado = 'COMPLETADO', actualizado_en = NOW() WHERE id_tarea = $1`,
      [id_tarea],
    );
    return;
  }

  if (resultado.tipo === 'RECHAZADO') {
    await client.query(`UPDATE comprobantes_afip SET estado_afip = 'RECHAZADO', error_afip_mensaje = $1 WHERE id_documento = $2`, [
      resultado.mensaje,
      id_documento,
    ]);
    await client.query(
      `UPDATE cola_facturacion_afip SET estado = 'FALLIDO', ultimo_error = $1, actualizado_en = NOW() WHERE id_tarea = $2`,
      [resultado.mensaje, id_tarea],
    );
    return;
  }

  await client.query(`UPDATE comprobantes_afip SET error_afip_mensaje = $1 WHERE id_documento = $2`, [
    resultado.mensaje,
    id_documento,
  ]);
  const reintentos = reintentosPrevios + 1;
  const agotado = reintentos >= maxReintentos;
  await client.query(
    `UPDATE cola_facturacion_afip
     SET reintentos = $1, estado = $2, proximo_reintento = $3, ultimo_error = $4, actualizado_en = NOW()
     WHERE id_tarea = $5`,
    [reintentos, agotado ? 'FALLIDO' : 'PENDIENTE', calcularProximoReintento(reintentos), resultado.mensaje, id_tarea],
  );
}

export async function obtenerEstadoServicio(): Promise<EstadoServicioAfip> {
  const { rows } = await pool.query<{
    pendientes: string;
    fallidas: string;
    ultima_contingencia: string | null;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE estado IN ('PENDIENTE', 'PROCESANDO')) AS pendientes,
       COUNT(*) FILTER (WHERE estado = 'FALLIDO') AS fallidas,
       MAX(creado_en) FILTER (WHERE estado IN ('PENDIENTE', 'PROCESANDO', 'FALLIDO')) AS ultima_contingencia
     FROM cola_facturacion_afip`,
  );
  const fila = rows[0];
  const pendientes = Number(fila?.pendientes ?? 0);
  const fallidas = Number(fila?.fallidas ?? 0);
  return {
    online: pendientes === 0 && fallidas === 0,
    tareas_pendientes: pendientes,
    tareas_falladas: fallidas,
    ultima_contingencia: fila?.ultima_contingencia ?? null,
  };
}
