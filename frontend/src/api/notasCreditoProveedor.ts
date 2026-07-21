import { apiFetch } from './client';
import type { CrearNotaCreditoProveedorInput, EstadoNotaCreditoProveedor, NotaCreditoProveedor } from '../types/domain';

export function buscarNotasCreditoProveedor(
  id_proveedor?: number,
  estado?: EstadoNotaCreditoProveedor,
): Promise<{ notasCredito: NotaCreditoProveedor[] }> {
  const params = new URLSearchParams();
  if (id_proveedor !== undefined) params.set('id_proveedor', String(id_proveedor));
  if (estado !== undefined) params.set('estado', estado);
  const query = params.toString();
  return apiFetch(`/notas-credito-proveedor${query ? `?${query}` : ''}`);
}

export function crearNotaCreditoProveedor(
  input: CrearNotaCreditoProveedorInput,
): Promise<{ notaCredito: NotaCreditoProveedor }> {
  return apiFetch('/notas-credito-proveedor', { method: 'POST', body: input });
}
