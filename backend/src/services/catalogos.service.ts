import { pool } from '../config/db';
import type { CuentaEmpresa, Sucursal } from '../types/domain';

export async function listarSucursales(): Promise<Sucursal[]> {
  const { rows } = await pool.query<Sucursal>(`SELECT id_sucursal, nombre FROM sucursales ORDER BY nombre`);
  return rows;
}

export async function listarCuentasEmpresa(): Promise<CuentaEmpresa[]> {
  const { rows } = await pool.query<CuentaEmpresa>(
    `SELECT id_cuenta, nombre_cuenta FROM cuentas_empresa ORDER BY nombre_cuenta`,
  );
  return rows;
}
