import { apiFetch } from './client';
import type { Camion, Zona } from '../types/domain';

export function listarZonas(): Promise<{ zonas: Zona[] }> {
  return apiFetch('/logistica/zonas');
}

export function listarCamiones(): Promise<{ camiones: Camion[] }> {
  return apiFetch('/logistica/camiones');
}
