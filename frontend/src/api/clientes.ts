import { apiFetch } from './client';
import type { Cliente, TipoDocumento } from '../types/domain';

export function buscarClientePorIdentificacion(
  cuitDni: string,
): Promise<{ cliente: Cliente; tipo_documento_sugerido: TipoDocumento }> {
  return apiFetch(`/clientes/identificacion/${encodeURIComponent(cuitDni)}`);
}

export function buscarClientes(termino: string): Promise<{ clientes: Cliente[] }> {
  return apiFetch(`/clientes?buscar=${encodeURIComponent(termino)}`);
}
