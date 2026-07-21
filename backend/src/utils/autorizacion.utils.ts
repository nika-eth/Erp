import { AppError } from './AppError';
import type { Rol } from '../types/domain';

export interface ContextoAcceso {
  rol: Rol;
  id_sucursal: number;
}

/** VENDEDOR queda limitado a su propia sucursal; ADMIN/SUPERVISOR acceden a cualquiera. */
export function verificarAccesoSucursal(contexto: ContextoAcceso, idSucursalRecurso: number): void {
  if (contexto.rol === 'VENDEDOR' && contexto.id_sucursal !== idSucursalRecurso) {
    throw AppError.forbidden('No tenés acceso a un recurso de otra sucursal.');
  }
}
