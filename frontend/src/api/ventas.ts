import { apiFetch } from './client';
import type { Documento, FacturarVentaInput, FacturarVentaResult, ItemInput } from '../types/domain';

export function facturarVenta(input: FacturarVentaInput): Promise<FacturarVentaResult> {
  return apiFetch('/ventas/facturar', { method: 'POST', body: input });
}

export function guardarPresupuesto(
  cliente_id: number,
  items: ItemInput[],
): Promise<{ documento: Documento }> {
  return apiFetch('/ventas/presupuesto', { method: 'POST', body: { cliente_id, items } });
}
