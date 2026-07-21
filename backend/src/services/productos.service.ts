import { pool } from '../config/db';
import type { Producto } from '../types/domain';

/** Buscador de productos para el catálogo flotante de Carga Unificada (F1). */
export async function buscarProductos(termino: string): Promise<Producto[]> {
  const { rows } = await pool.query<Producto>(
    `SELECT id_producto, sku, descripcion, unidad_venta, peso_teorico_kg, activo
     FROM productos
     WHERE activo = TRUE AND (sku ILIKE $1 OR descripcion ILIKE $1)
     ORDER BY descripcion
     LIMIT 20`,
    [`%${termino}%`],
  );
  return rows;
}
