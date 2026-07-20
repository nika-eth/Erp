import { apiFetch } from './client';
import type { EstadoServicioAfip } from '../types/domain';

export function obtenerEstadoAfip(): Promise<EstadoServicioAfip> {
  return apiFetch('/afip/estado');
}

export function reintentarTareaAfip(idTarea: number): Promise<{ ok: true }> {
  return apiFetch(`/afip/reintentar/${idTarea}`, { method: 'POST' });
}
