import { apiFetch } from './client';
import type {
  Documento,
  FacturarComprobanteInternoResult,
  FacturarVentaInput,
  FacturarVentaResult,
  ItemInput,
} from '../types/domain';

/**
 * `pinSupervisor`, si viene, viaja como header `x-supervisor-pin` para
 * autorizar una venta que excede el límite de crédito del cliente (ver
 * `verifySupervisorOverride` en el backend).
 */
export function facturarVenta(input: FacturarVentaInput, pinSupervisor?: string): Promise<FacturarVentaResult> {
  return apiFetch('/ventas/facturar', {
    method: 'POST',
    body: input,
    headers: pinSupervisor ? { 'x-supervisor-pin': pinSupervisor } : undefined,
  });
}

export function guardarPresupuesto(
  cliente_id: number,
  items: ItemInput[],
): Promise<{ documento: Documento }> {
  return apiFetch('/ventas/presupuesto', { method: 'POST', body: { cliente_id, items } });
}

/** Convierte un Comprobante Interno ya despachado en Factura fiscal (ver `FichaDespacho.tsx`). */
export function facturarComprobanteInterno(id_documento: number): Promise<FacturarComprobanteInternoResult> {
  return apiFetch(`/ventas/${id_documento}/facturar-interno`, { method: 'POST', body: {} });
}
