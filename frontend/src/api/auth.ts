import { apiFetch } from './client';
import type { Rol, SesionUsuario, Sucursal } from '../types/domain';

export interface LoginResponse {
  token: string;
  sesion: SesionUsuario;
  sucursal: Sucursal;
}

export function login(id_sucursal: number, rol: Rol, vendedor: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { id_sucursal, rol, vendedor },
    auth: false,
  });
}
