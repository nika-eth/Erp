import { apiFetch } from './client';
import type { Producto } from '../types/domain';

/** Catálogo flotante de Carga Unificada (F1): búsqueda por SKU o descripción. */
export function buscarProductos(termino: string): Promise<{ productos: Producto[] }> {
  return apiFetch(`/productos?buscar=${encodeURIComponent(termino)}`);
}
