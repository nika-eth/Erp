import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { pool } from '../config/db';
import { AppError } from '../utils/AppError';
import { esRolValido } from '../middleware/session';
import type { Sucursal } from '../types/domain';

/**
 * POST /api/auth/login
 *
 * El modelo de datos provisto no incluye una tabla `usuarios`, así que este
 * endpoint no valida contraseña: emite el JWT de sesión a partir de la
 * sucursal, el rol y el nombre de vendedor elegidos al iniciar el turno.
 * Reemplazar por un flujo de credenciales reales en cuanto exista esa tabla.
 */
export async function postLogin(req: Request, res: Response): Promise<void> {
  const { id_sucursal, rol, vendedor } = req.body as {
    id_sucursal?: number;
    rol?: string;
    vendedor?: string;
  };

  if (!Number.isInteger(id_sucursal) || !esRolValido(rol) || !vendedor?.trim()) {
    throw AppError.badRequest(
      'PAYLOAD_INVALIDO',
      'id_sucursal (entero), rol (ADMIN|SUPERVISOR|VENDEDOR) y vendedor son requeridos.',
    );
  }

  const { rows } = await pool.query<Sucursal>(`SELECT id_sucursal, nombre FROM sucursales WHERE id_sucursal = $1`, [
    id_sucursal,
  ]);
  const sucursal = rows[0];
  if (!sucursal) {
    throw AppError.badRequest('SUCURSAL_INVALIDA', `No existe la sucursal id_sucursal=${id_sucursal}`);
  }

  const sesion = { id_sucursal: sucursal.id_sucursal, rol, vendedor: vendedor.trim() };
  const token = jwt.sign(sesion, env.jwt.secret, { expiresIn: env.jwt.expiresIn } as jwt.SignOptions);

  res.json({ token, sesion, sucursal });
}
