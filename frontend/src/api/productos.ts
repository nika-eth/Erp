import { apiFetch } from './client';
import type { ActualizarProductoInput, Producto } from '../types/domain';

/** Catálogo flotante de Carga Unificada (F1): búsqueda por SKU o descripción. Sólo activos. */
export function buscarProductos(termino: string): Promise<{ productos: Producto[] }> {
  return apiFetch(`/productos?buscar=${encodeURIComponent(termino)}`);
}

/** Gestión de Productos (F7): búsqueda que incluye inactivos. */
export function buscarProductosParaGestion(termino: string): Promise<{ productos: Producto[] }> {
  return apiFetch(`/productos/gestion?buscar=${encodeURIComponent(termino)}`);
}

export function actualizarProducto(
  id_producto: number,
  input: ActualizarProductoInput,
): Promise<{ producto: Producto }> {
  return apiFetch(`/productos/${id_producto}`, { method: 'PATCH', body: input });
}
