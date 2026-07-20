import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env';
import type { UserPayload } from '../../src/types/domain';

export function crearToken(payload: Partial<UserPayload> = {}): string {
  const completo: UserPayload = {
    id_usuario: 1,
    usuario: 'test.vendedor',
    nombre: 'Test Vendedor',
    rol: 'VENDEDOR',
    id_sucursal: 1,
    ...payload,
  };
  return jwt.sign(completo, env.jwt.secret, { expiresIn: '1h' });
}
