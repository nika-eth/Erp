import { apiFetch } from './client';
import type { CrearFacturaProveedorInput, EstadoFacturaProveedor, FacturaProveedor } from '../types/domain';

export function buscarFacturasProveedor(
  id_proveedor?: number,
  estado?: EstadoFacturaProveedor,
): Promise<{ facturas: FacturaProveedor[] }> {
  const params = new URLSearchParams();
  if (id_proveedor !== undefined) params.set('id_proveedor', String(id_proveedor));
  if (estado !== undefined) params.set('estado', estado);
  const query = params.toString();
  return apiFetch(`/facturas-proveedor${query ? `?${query}` : ''}`);
}

export function crearFacturaProveedor(input: CrearFacturaProveedorInput): Promise<{ factura: FacturaProveedor }> {
  return apiFetch('/facturas-proveedor', { method: 'POST', body: input });
}
