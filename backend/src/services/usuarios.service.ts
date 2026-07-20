import { pool } from '../config/db';
import type { Usuario } from '../types/domain';

export async function buscarUsuarioPorUsuario(usuario: string): Promise<Usuario | null> {
  const { rows } = await pool.query<Usuario>(
    `SELECT id_usuario, nombre, usuario, password_hash, pin_autorizacion_hash, rol, id_sucursal, activo
     FROM usuarios WHERE usuario = $1 AND activo = TRUE`,
    [usuario.trim()],
  );
  return rows[0] ?? null;
}

/** Supervisores/admins activos con PIN configurado, candidatos a autorizar un override de crédito. */
export async function listarSupervisoresConPin(): Promise<Usuario[]> {
  const { rows } = await pool.query<Usuario>(
    `SELECT id_usuario, nombre, usuario, password_hash, pin_autorizacion_hash, rol, id_sucursal, activo
     FROM usuarios
     WHERE rol IN ('SUPERVISOR', 'ADMIN') AND activo = TRUE AND pin_autorizacion_hash IS NOT NULL`,
  );
  return rows;
}
