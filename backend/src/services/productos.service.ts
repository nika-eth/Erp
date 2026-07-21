import { pool } from '../config/db';
import { AppError } from '../utils/AppError';
import type { ActualizarProductoInput, Producto, UnidadVentaProducto } from '../types/domain';

const UNIDADES_VENTA_VALIDAS: UnidadVentaProducto[] = ['KILO', 'UNIDAD'];

/** Buscador de productos para el catálogo flotante de Carga Unificada (F1). Sólo productos activos. */
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

/** Buscador para Gestión de Productos (F7): incluye inactivos, para poder reactivarlos. */
export async function buscarProductosParaGestion(termino: string): Promise<Producto[]> {
  const { rows } = await pool.query<Producto>(
    `SELECT id_producto, sku, descripcion, unidad_venta, peso_teorico_kg, activo
     FROM productos
     WHERE sku ILIKE $1 OR descripcion ILIKE $1
     ORDER BY descripcion
     LIMIT 20`,
    [`%${termino}%`],
  );
  return rows;
}

/**
 * Corrige datos de un producto ya existente (ej. `peso_teorico_kg` en los
 * productos KILO importados sin peso desde el Excel de stock inicial). `sku`
 * no se puede editar: es la referencia estable ya usada en ventas históricas
 * (`documentos_detalles.sku`).
 */
export async function actualizarProducto(id_producto: number, input: ActualizarProductoInput): Promise<Producto> {
  const campos: string[] = [];
  const valores: unknown[] = [];

  if (input.descripcion !== undefined) {
    const descripcion = input.descripcion.trim();
    if (!descripcion) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'La descripción no puede quedar vacía.');
    }
    valores.push(descripcion);
    campos.push(`descripcion = $${valores.length}`);
  }
  if (input.unidad_venta !== undefined) {
    if (!UNIDADES_VENTA_VALIDAS.includes(input.unidad_venta)) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'unidad_venta debe ser KILO o UNIDAD.');
    }
    valores.push(input.unidad_venta);
    campos.push(`unidad_venta = $${valores.length}`);
  }
  if (input.peso_teorico_kg !== undefined) {
    if (typeof input.peso_teorico_kg !== 'number' || Number.isNaN(input.peso_teorico_kg) || input.peso_teorico_kg < 0) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'peso_teorico_kg debe ser un número mayor o igual a 0.');
    }
    valores.push(input.peso_teorico_kg);
    campos.push(`peso_teorico_kg = $${valores.length}`);
  }
  if (input.activo !== undefined) {
    valores.push(input.activo);
    campos.push(`activo = $${valores.length}`);
  }

  if (campos.length === 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'No se envió ningún campo para actualizar.');
  }

  valores.push(id_producto);
  const { rows } = await pool.query<Producto>(
    `UPDATE productos SET ${campos.join(', ')} WHERE id_producto = $${valores.length}
     RETURNING id_producto, sku, descripcion, unidad_venta, peso_teorico_kg, activo`,
    valores,
  );

  const producto = rows[0];
  if (!producto) {
    throw AppError.notFound('PRODUCTO_NO_ENCONTRADO', `No existe el producto id_producto=${id_producto}`);
  }
  return producto;
}
