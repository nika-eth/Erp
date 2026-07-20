import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import type { Rol, UserPayload } from '../types/domain';

const ROLES_VALIDOS: Rol[] = ['ADMIN', 'SUPERVISOR', 'VENDEDOR'];

export function esRolValido(valor: unknown): valor is Rol {
  return typeof valor === 'string' && (ROLES_VALIDOS as string[]).includes(valor);
}

/**
 * Valida el Bearer token e inyecta en `req.user` la identidad firmada por
 * `POST /api/auth/login` (`id_usuario`, `rol`, `id_sucursal`, ...). Como
 * `id_sucursal` viaja dentro del JWT firmado, ningún vendedor puede
 * facturar a nombre de otra sucursal manipulando el body del request.
 */
export function authenticateJWT(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw AppError.unauthorized('Token no provisto o formato inválido (Authorization: Bearer <token>)');
  }

  const token = authHeader.slice('Bearer '.length);
  try {
    const decoded = jwt.verify(token, env.jwt.secret) as UserPayload;
    if (!Number.isInteger(decoded.id_usuario) || !esRolValido(decoded.rol) || !Number.isInteger(decoded.id_sucursal)) {
      throw new Error('Payload de sesión incompleto');
    }
    req.user = decoded;
    next();
  } catch {
    throw AppError.unauthorized('Sesión expirada o token inválido');
  }
}

/** Restringe el acceso a un subconjunto de roles. Usar después de `authenticateJWT`. */
export function requireRole(...rolesPermitidos: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw AppError.unauthorized();
    }
    if (!rolesPermitidos.includes(req.user.rol)) {
      throw AppError.forbidden(`Esta acción requiere rol: ${rolesPermitidos.join(' o ')}`);
    }
    next();
  };
}
