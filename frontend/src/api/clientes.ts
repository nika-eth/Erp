import { apiFetch } from './client';
import type { Cliente, CrearClienteInput, TipoDocumento } from '../types/domain';

export function buscarClientePorIdentificacion(
  numeroDocumento: string,
): Promise<{ cliente: Cliente; tipo_documento_sugerido: TipoDocumento }> {
  return apiFetch(`/clientes/identificacion/${encodeURIComponent(numeroDocumento)}`);
}

export function buscarClientes(termino: string): Promise<{ clientes: Cliente[] }> {
  return apiFetch(`/clientes?buscar=${encodeURIComponent(termino)}`);
}

export function crearCliente(input: CrearClienteInput): Promise<{ cliente: Cliente }> {
  return apiFetch('/clientes', { method: 'POST', body: input });
}
