import { apiFetch } from './client';
import type { AnularRemitoInput, GenerarRemitoInput, Remito } from '../types/domain';

export function generarRemito(input: GenerarRemitoInput): Promise<{ remito: Remito }> {
  return apiFetch('/remitos/generar', { method: 'POST', body: input });
}

export function anularRemito(id_remito: number, input: AnularRemitoInput): Promise<{ remito: Remito }> {
  return apiFetch(`/remitos/${id_remito}/anular`, { method: 'POST', body: input });
}

export function listarRemitosPorDocumento(id_documento: number): Promise<{ remitos: Remito[] }> {
  return apiFetch(`/remitos/documento/${id_documento}`);
}
