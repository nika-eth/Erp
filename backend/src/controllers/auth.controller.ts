import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { pool } from '../config/db';
import { AppError } from '../utils/AppError';
import { buscarUsuarioPorUsuario } from '../services/usuarios.service';
import type { Sucursal, UserPayload } from '../types/domain';

/**
 * POST /api/auth/login
 *
 * Autenticación real contra la tabla `usuarios`. La sucursal del usuario
 * (`usuarios.id_sucursal`) viaja firmada dentro del JWT: no la elige quien
 * inicia sesión, para que no se pueda facturar a nombre de otra sucursal
 * manipulando el request.
 */
export async function postLogin(req: Request, res: Response): Promise<void> {
  const { usuario, password } = req.body as { usuario?: string; password?: string };

  if (!usuario?.trim() || !password) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'usuario y password son requeridos.');
  }

  // Mensaje idéntico ante usuario inexistente o password incorrecta, para no
  // filtrar qué usuarios existen.
  const credencialesInvalidas = () => AppError.unauthorized('Usuario o contraseña incorrectos.');

  const fila = await buscarUsuarioPorUsuario(usuario);
  if (!fila) {
    throw credencialesInvalidas();
  }

  const passwordValida = await bcrypt.compare(password, fila.password_hash);
  if (!passwordValida) {
    throw credencialesInvalidas();
  }

  if (!fila.id_sucursal) {
    throw AppError.badRequest(
      'USUARIO_SIN_SUCURSAL',
      `El usuario "${fila.usuario}" no tiene una sucursal asignada; no puede operar el mostrador.`,
    );
  }

  const { rows: sucursalRows } = await pool.query<Sucursal>(
    `SELECT id_sucursal, nombre FROM sucursales WHERE id_sucursal = $1`,
    [fila.id_sucursal],
  );
  const sucursal = sucursalRows[0];
  if (!sucursal) {
    throw AppError.badRequest('SUCURSAL_INVALIDA', `La sucursal asignada al usuario ya no existe.`);
  }

  const payload: UserPayload = {
    id_usuario: fila.id_usuario,
    usuario: fila.usuario,
    nombre: fila.nombre,
    rol: fila.rol,
    id_sucursal: fila.id_sucursal,
  };
  const token = jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn } as jwt.SignOptions);

  res.json({ token, user: payload, sucursal });
}
