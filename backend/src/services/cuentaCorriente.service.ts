import { pool } from '../config/db';
import { AppError } from '../utils/AppError';
import type { FichaCuentaCorriente, MovimientoCuentaCorriente } from '../types/domain';

/**
 * Devuelve el resumen del cliente (nombre, CUIT, límite de crédito, saldo
 * total) junto con el historial de movimientos con el SALDO ACUMULADO
 * corrido (DEBE - HABER), calculado en la base con `SUM() OVER()` en vez de
 * en memoria en Node — tal como exige la estructura obligatoria de 3
 * columnas DEBE | HABER | SALDO ACUMULADO de la Ficha Contable (F9).
 */
export async function obtenerFichaCuentaCorriente(cliente_id: number): Promise<FichaCuentaCorriente> {
  const { rows: clienteRows } = await pool.query<{
    id_cliente: number;
    nombre: string;
    tipo_documento: 'DNI' | 'CUIT';
    numero_documento: string;
    limite_credito: string;
  }>(`SELECT id_cliente, nombre, tipo_documento, numero_documento, limite_credito FROM clientes WHERE id_cliente = $1`, [
    cliente_id,
  ]);
  const cliente = clienteRows[0];
  if (!cliente) {
    throw AppError.notFound('CLIENTE_NO_ENCONTRADO', `No existe el cliente id_cliente=${cliente_id}`);
  }

  const { rows } = await pool.query<MovimientoCuentaCorriente & { saldo: string }>(
    `SELECT
       id_movimiento,
       cliente_id,
       fecha,
       debe,
       haber,
       id_documento,
       id_cuenta,
       id_recibo,
       concepto,
       SUM(debe - haber) OVER (
         PARTITION BY cliente_id
         ORDER BY fecha ASC, id_movimiento ASC
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS saldo
     FROM cuenta_corriente
     WHERE cliente_id = $1
     ORDER BY fecha ASC, id_movimiento ASC`,
    [cliente_id],
  );

  const saldo_total = rows.length > 0 ? rows[rows.length - 1].saldo : '0';

  return { cliente, movimientos: rows, saldo_total };
}

/** Saldo deudor actual del cliente (DEBE acumulado - HABER acumulado). */
export async function obtenerSaldoActual(cliente_id: number): Promise<number> {
  const { rows } = await pool.query<{ saldo: string }>(
    `SELECT COALESCE(SUM(debe) - SUM(haber), 0) AS saldo FROM cuenta_corriente WHERE cliente_id = $1`,
    [cliente_id],
  );
  return Number(rows[0]?.saldo ?? 0);
}
