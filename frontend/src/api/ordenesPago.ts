import { apiFetch } from './client';
import type { AnularOrdenPagoInput, EmitirOrdenPagoInput, EmitirOrdenPagoResult, OrdenPago } from '../types/domain';

export function buscarOrdenesPago(id_proveedor?: number): Promise<{ ordenesPago: OrdenPago[] }> {
  const query = id_proveedor !== undefined ? `?id_proveedor=${id_proveedor}` : '';
  return apiFetch(`/ordenes-pago${query}`);
}

export function emitirOrdenPago(input: EmitirOrdenPagoInput): Promise<EmitirOrdenPagoResult> {
  return apiFetch('/ordenes-pago', { method: 'POST', body: input });
}

export function anularOrdenPago(
  id_orden_pago: number,
  input: AnularOrdenPagoInput,
): Promise<{ ordenPago: OrdenPago }> {
  return apiFetch(`/ordenes-pago/${id_orden_pago}/anular`, { method: 'POST', body: input });
}
