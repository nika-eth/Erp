import { apiFetch } from './client';
import type { ActualizarProveedorInput, CrearProveedorInput, Proveedor } from '../types/domain';

/** Búsqueda por nombre o CUIT/DNI, sólo activos. */
export function buscarProveedores(termino: string): Promise<{ proveedores: Proveedor[] }> {
  return apiFetch(`/proveedores?buscar=${encodeURIComponent(termino)}`);
}

/** Gestión de Proveedores: búsqueda que incluye inactivos. */
export function buscarProveedoresParaGestion(termino: string): Promise<{ proveedores: Proveedor[] }> {
  return apiFetch(`/proveedores/gestion?buscar=${encodeURIComponent(termino)}`);
}

export function crearProveedor(input: CrearProveedorInput): Promise<{ proveedor: Proveedor }> {
  return apiFetch('/proveedores', { method: 'POST', body: input });
}

export function actualizarProveedor(
  id_proveedor: number,
  input: ActualizarProveedorInput,
): Promise<{ proveedor: Proveedor }> {
  return apiFetch(`/proveedores/${id_proveedor}`, { method: 'PATCH', body: input });
}
