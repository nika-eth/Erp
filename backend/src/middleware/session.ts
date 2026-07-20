import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import type { Rol, SesionUsuario } from '../types/domain';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sesion?: SesionUsuario;
    }
  }
}

const ROLES_VALIDOS: Rol[] = ['ADMIN', 'SUPERVISOR', 'VENDEDOR'];

export function esRolValido(valor: unknown): valor is Rol {
  return typeof valor === 'string' && (ROLES_VALIDOS as string[]).includes(valor);
}

/**
 * El modelo de datos provisto no incluye una tabla `usuarios`, por lo que
 * no hay credenciales reales contra las cuales autenticar. Este middleware
 * exige un JWT (emitido por `POST /api/auth/login`) que ata cada request a
 * una sucursal, un rol y un vendedor, tal como pide la regla de "Identidad
 * por Sesión". Reemplazar por autenticación real en cuanto exista la tabla.
 */
export function requireSession(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw AppError.unauthorized('Falta el token de sesión (Authorization: Bearer <token>)');
  }

  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, env.jwt.secret) as SesionUsuario;
    if (!payload.id_sucursal || !esRolValido(payload.rol) || !payload.vendedor) {
      throw new Error('Payload de sesión incompleto');
    }
    req.sesion = payload;
    next();
  } catch {
    throw AppError.unauthorized('Token de sesión inválido o expirado');
  }
}

/** Restringe el acceso a un subconjunto de roles. Usar después de `requireSession`. */
export function requireRol(...rolesPermitidos: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.sesion) {
      throw AppError.unauthorized();
    }
    if (!rolesPermitidos.includes(req.sesion.rol)) {
      throw AppError.forbidden(`Esta acción requiere rol: ${rolesPermitidos.join(' o ')}`);
    }
    next();
  };
}
