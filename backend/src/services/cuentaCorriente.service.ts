import { pool } from '../config/db';
import type { MovimientoCuentaCorriente } from '../types/domain';

export interface FichaCuentaCorriente {
  cliente_id: number;
  movimientos: Array<MovimientoCuentaCorriente & { saldo: string }>;
  saldo_total: string;
}

/**
 * Devuelve los movimientos de un cliente con el SALDO corrido (DEBE - HABER
 * acumulado), tal como exige la estructura obligatoria de 3 columnas
 * DEBE | HABER | SALDO TOTAL de la Ficha Contable (F9).
 */
export async function obtenerFichaCuentaCorriente(cliente_id: number): Promise<FichaCuentaCorriente> {
  const { rows } = await pool.query<MovimientoCuentaCorriente & { saldo: string }>(
    `SELECT
       id_movimiento,
       cliente_id,
       fecha,
       debe,
       haber,
       id_documento,
       id_cuenta,
       concepto,
       SUM(debe - haber) OVER (ORDER BY fecha, id_movimiento
                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo
     FROM cuenta_corriente
     WHERE cliente_id = $1
     ORDER BY fecha, id_movimiento`,
    [cliente_id],
  );

  const saldo_total = rows.length > 0 ? rows[rows.length - 1].saldo : '0';

  return { cliente_id, movimientos: rows, saldo_total };
}

/** Saldo deudor actual del cliente (DEBE acumulado - HABER acumulado). */
export async function obtenerSaldoActual(cliente_id: number): Promise<number> {
  const { rows } = await pool.query<{ saldo: string }>(
    `SELECT COALESCE(SUM(debe) - SUM(haber), 0) AS saldo FROM cuenta_corriente WHERE cliente_id = $1`,
    [cliente_id],
  );
  return Number(rows[0]?.saldo ?? 0);
}
