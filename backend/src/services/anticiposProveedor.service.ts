import { pool } from '../config/db';
import { AppError } from '../utils/AppError';
import type { AnticipoProveedor, EstadoAnticipoProveedor } from '../types/domain';

const COLUMNAS_ANTICIPO = `id_anticipo_proveedor, id_proveedor, id_orden_pago_origen, fecha, moneda, cotizacion, importe_total, saldo_disponible, estado`;

export async function buscarAnticipoProveedorPorId(id_anticipo_proveedor: number): Promise<AnticipoProveedor> {
  const { rows } = await pool.query<AnticipoProveedor>(
    `SELECT ${COLUMNAS_ANTICIPO} FROM anticipos_proveedor WHERE id_anticipo_proveedor = $1`,
    [id_anticipo_proveedor],
  );
  const anticipo = rows[0];
  if (!anticipo) {
    throw AppError.notFound(
      'ANTICIPO_PROVEEDOR_NO_ENCONTRADO',
      `No existe el anticipo id_anticipo_proveedor=${id_anticipo_proveedor}`,
    );
  }
  return anticipo;
}

/**
 * Sólo lectura en este incremento: el alta de un anticipo la va a hacer el
 * servicio de emisión de Órdenes de Pago (una OP sin imputaciones), todavía
 * no implementado — ver el supuesto flagueado en `012_cuentas_por_pagar.sql`.
 */
export async function buscarAnticiposProveedor(
  id_proveedor?: number,
  estado?: EstadoAnticipoProveedor,
): Promise<AnticipoProveedor[]> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  if (id_proveedor !== undefined) {
    valores.push(id_proveedor);
    condiciones.push(`id_proveedor = $${valores.length}`);
  }
  if (estado !== undefined) {
    valores.push(estado);
    condiciones.push(`estado = $${valores.length}`);
  }

  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
  const { rows } = await pool.query<AnticipoProveedor>(
    `SELECT ${COLUMNAS_ANTICIPO} FROM anticipos_proveedor ${where} ORDER BY fecha DESC LIMIT 50`,
    valores,
  );
  return rows;
}
