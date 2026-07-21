import { apiFetch } from './client';
import type { AnticipoProveedor, EstadoAnticipoProveedor } from '../types/domain';

export function buscarAnticiposProveedor(
  id_proveedor?: number,
  estado?: EstadoAnticipoProveedor,
): Promise<{ anticipos: AnticipoProveedor[] }> {
  const params = new URLSearchParams();
  if (id_proveedor !== undefined) params.set('id_proveedor', String(id_proveedor));
  if (estado !== undefined) params.set('estado', estado);
  const query = params.toString();
  return apiFetch(`/anticipos-proveedor${query ? `?${query}` : ''}`);
}
