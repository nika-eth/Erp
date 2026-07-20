import { apiFetch } from './client';
import type { FichaCuentaCorriente } from '../types/domain';

export function obtenerFichaCuentaCorriente(clienteId: number): Promise<FichaCuentaCorriente> {
  return apiFetch(`/cuenta-corriente/${clienteId}`);
}
