import { apiFetch } from './client';
import type {
  Documento,
  FacturarComprobanteInternoResult,
  FacturarVentaInput,
  FacturarVentaResult,
  ItemInput,
  ProcesarVentaMixtaInput,
  ProcesarVentaMixtaResult,
} from '../types/domain';

/**
 * `pinSupervisor`, si viene, viaja como header `x-supervisor-pin` para
 * autorizar una venta que excede el límite de crédito del cliente (ver
 * `verifySupervisorOverride` en el backend).
 *
 * Dos endpoints separados (no uno con `es_fiscal` en el body): el modo de
 * operación (Fiscal/Interna, ver `ModoOperacionContext`) se decide ANTES de
 * llamar acá, en la barra superior de Carga Unificada — `RendicionPago.tsx`
 * elige cuál de las dos llamar, nunca manda un flag.
 */
export function facturarVentaFiscal(input: FacturarVentaInput, pinSupervisor?: string): Promise<FacturarVentaResult> {
  return apiFetch('/ventas/facturar-fiscal', {
    method: 'POST',
    body: input,
    headers: pinSupervisor ? { 'x-supervisor-pin': pinSupervisor } : undefined,
  });
}

export function emitirVentaInterna(input: FacturarVentaInput, pinSupervisor?: string): Promise<FacturarVentaResult> {
  return apiFetch('/ventas/emitir-interno', {
    method: 'POST',
    body: input,
    headers: pinSupervisor ? { 'x-supervisor-pin': pinSupervisor } : undefined,
  });
}

/**
 * Venta mixta: renglones divididos entre retiro inmediato (despacha ya
 * mismo) y saldo pendiente (reserva stock y genera una Orden de Entrega
 * Pendiente). Ver `RendicionPago.tsx` (editor de split, F7).
 */
export function procesarVentaMixta(
  input: ProcesarVentaMixtaInput,
  pinSupervisor?: string,
): Promise<ProcesarVentaMixtaResult> {
  return apiFetch('/ventas/facturar-mixta', {
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
