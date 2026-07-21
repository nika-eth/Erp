import type { PoolClient } from 'pg';
import { AppError } from '../utils/AppError';

/**
 * Resuelve el id de una cuenta de sistema por su `codigo` fijo (nunca por
 * ID hardcodeado — ver seed de cuentas `es_sistema=true` en
 * `012_cuentas_por_pagar.sql`/`013_ordenes_pago_cuentas_sistema.sql`). Si
 * falta es un problema de datos (la cuenta debería estar sembrada), no un
 * error de payload del usuario.
 */
export async function obtenerIdCuentaPorCodigo(client: PoolClient, codigo: string): Promise<number> {
  const { rows } = await client.query<{ id_cuenta_contable: number }>(
    `SELECT id_cuenta_contable FROM plan_cuentas WHERE codigo = $1`,
    [codigo],
  );
  const cuenta = rows[0];
  if (!cuenta) {
    throw AppError.conflict('CUENTA_SISTEMA_FALTANTE', `Falta sembrar la cuenta contable de sistema con código ${codigo}.`);
  }
  return cuenta.id_cuenta_contable;
}
