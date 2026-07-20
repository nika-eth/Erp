import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env';
import type { SesionUsuario } from '../../src/types/domain';

export function crearToken(sesion: Partial<SesionUsuario> = {}): string {
  const payload: SesionUsuario = {
    id_sucursal: 1,
    rol: 'VENDEDOR',
    vendedor: 'Test Vendedor',
    ...sesion,
  };
  return jwt.sign(payload, env.jwt.secret, { expiresIn: '1h' });
}
