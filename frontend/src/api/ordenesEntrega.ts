import { apiFetch } from './client';
import type { AnularOrdenEntregaInput, OrdenEntrega } from '../types/domain';

/** Busca una Orden de Entrega Pendiente por su número (ej. `OE-1-000042`). */
export function buscarOrdenEntrega(nroOrden: string): Promise<{ orden_entrega: OrdenEntrega }> {
  return apiFetch(`/ordenes-entrega/${encodeURIComponent(nroOrden)}`);
}

/**
 * Retira (cumple) la orden desde la sucursal del operador — que puede no ser
 * la de origen: en ese caso es un despacho cruzado. Todo-o-nada por renglón.
 */
export function retirarOrdenEntrega(nroOrden: string): Promise<{ orden_entrega: OrdenEntrega }> {
  return apiFetch(`/ordenes-entrega/${encodeURIComponent(nroOrden)}/retirar`, { method: 'POST', body: {} });
}

/** Anula la orden liberando la reserva, sin despacho físico. Requiere motivo. */
export function anularOrdenEntrega(
  nroOrden: string,
  input: AnularOrdenEntregaInput,
): Promise<{ orden_entrega: OrdenEntrega }> {
  return apiFetch(`/ordenes-entrega/${encodeURIComponent(nroOrden)}/anular`, { method: 'POST', body: input });
}
