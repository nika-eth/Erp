import type { PoolClient } from 'pg';
import { pool } from '../config/db';
import { AppError } from '../utils/AppError';
import type { Cliente } from '../types/domain';

export async function buscarClientePorId(id_cliente: number, client?: PoolClient): Promise<Cliente> {
  const runner = client ?? pool;
  const { rows } = await runner.query<Cliente>(
    `SELECT id_cliente, nombre, cuit_dni, limite_credito, id_zona FROM clientes WHERE id_cliente = $1`,
    [id_cliente],
  );
  const cliente = rows[0];
  if (!cliente) {
    throw AppError.notFound('CLIENTE_NO_ENCONTRADO', `No existe el cliente id_cliente=${id_cliente}`);
  }
  return cliente;
}

export async function buscarClientePorCuitDni(cuit_dni: string): Promise<Cliente | null> {
  const { rows } = await pool.query<Cliente>(
    `SELECT id_cliente, nombre, cuit_dni, limite_credito, id_zona FROM clientes WHERE cuit_dni = $1`,
    [cuit_dni.trim()],
  );
  return rows[0] ?? null;
}

export async function buscarClientes(termino: string): Promise<Cliente[]> {
  const { rows } = await pool.query<Cliente>(
    `SELECT id_cliente, nombre, cuit_dni, limite_credito, id_zona
     FROM clientes
     WHERE cuit_dni ILIKE $1 OR nombre ILIKE $1
     ORDER BY nombre
     LIMIT 20`,
    [`%${termino}%`],
  );
  return rows;
}
