import { apiFetch } from './client';
import type { Sucursal, UserPayload } from '../types/domain';

export interface LoginResponse {
  token: string;
  user: UserPayload;
  sucursal: Sucursal;
}

export function login(usuario: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { usuario, password },
    auth: false,
  });
}
