import { apiFetch } from './client';
import type { Documento, TipoDocumento } from '../types/domain';

export interface FiltroHistorial {
  cliente?: string;
  nro_remito?: number;
  tipo_documento?: TipoDocumento;
}

export function buscarDocumentos(filtro: FiltroHistorial): Promise<{ documentos: Documento[] }> {
  const params = new URLSearchParams();
  if (filtro.cliente) params.set('cliente', filtro.cliente);
  if (filtro.nro_remito) params.set('nro_remito', String(filtro.nro_remito));
  if (filtro.tipo_documento) params.set('tipo_documento', filtro.tipo_documento);
  return apiFetch(`/documentos?${params.toString()}`);
}

export function obtenerDocumento(id_documento: number): Promise<{ documento: Documento }> {
  return apiFetch(`/documentos/${id_documento}`);
}
