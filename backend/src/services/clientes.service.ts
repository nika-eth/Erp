import type { PoolClient } from 'pg';
import { pool } from '../config/db';
import { AppError } from '../utils/AppError';
import { esCuitValido, largoValidoParaTipoDocumento } from '../utils/identificacion.utils';
import type { Cliente, CrearClienteInput } from '../types/domain';

const COLUMNAS_CLIENTE = `id_cliente, nombre, tipo_documento, numero_documento, condicion_iva, limite_credito, id_zona, direccion, telefono, email`;

export async function buscarClientePorId(id_cliente: number, client?: PoolClient): Promise<Cliente> {
  const runner = client ?? pool;
  const { rows } = await runner.query<Cliente>(
    `SELECT ${COLUMNAS_CLIENTE} FROM clientes WHERE id_cliente = $1`,
    [id_cliente],
  );
  const cliente = rows[0];
  if (!cliente) {
    throw AppError.notFound('CLIENTE_NO_ENCONTRADO', `No existe el cliente id_cliente=${id_cliente}`);
  }
  return cliente;
}

export async function buscarClientePorNumeroDocumento(numeroDocumento: string): Promise<Cliente | null> {
  const { rows } = await pool.query<Cliente>(
    `SELECT ${COLUMNAS_CLIENTE} FROM clientes WHERE numero_documento = $1`,
    [numeroDocumento.replace(/\D/g, '')],
  );
  return rows[0] ?? null;
}

export async function buscarClientes(termino: string): Promise<Cliente[]> {
  const { rows } = await pool.query<Cliente>(
    `SELECT ${COLUMNAS_CLIENTE}
     FROM clientes
     WHERE numero_documento ILIKE $1 OR nombre ILIKE $1
     ORDER BY nombre
     LIMIT 20`,
    [`%${termino}%`],
  );
  return rows;
}

/**
 * Alta de cliente en mostrador. Pensada para el caso "llega un cliente que
 * no está cargado": se dispara desde Carga Unificada (F5) cuando la
 * búsqueda por CUIT/DNI da 404, sin tener que salir de la venta en curso.
 *
 * Reglas AFIP validadas acá (no en la base): un DNI sólo puede ser
 * CONSUMIDOR_FINAL; un CUIT nunca puede serlo; y un CUIT tiene que tener un
 * dígito verificador válido (Módulo 11) para no cargar CUITs inventados.
 */
export async function crearCliente(input: CrearClienteInput): Promise<Cliente> {
  const nombre = input.nombre?.trim() ?? '';
  const numeroDocumento = input.numero_documento?.trim().replace(/\D/g, '') ?? '';
  const tipoDocumento = input.tipo_documento;

  if (!nombre) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'El nombre del cliente es requerido.');
  }
  if (tipoDocumento !== 'DNI' && tipoDocumento !== 'CUIT') {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'tipo_documento debe ser DNI o CUIT.');
  }
  if (!largoValidoParaTipoDocumento(tipoDocumento, numeroDocumento)) {
    throw AppError.badRequest(
      'PAYLOAD_INVALIDO',
      tipoDocumento === 'CUIT'
        ? 'Un CUIT debe tener 11 dígitos.'
        : 'Un DNI debe tener 7 u 8 dígitos.',
    );
  }
  if (tipoDocumento === 'CUIT' && !esCuitValido(numeroDocumento)) {
    throw AppError.badRequest('CUIT_INVALIDO', 'El CUIT ingresado no tiene un dígito verificador válido.');
  }
  if (tipoDocumento === 'DNI' && input.condicion_iva !== 'CONSUMIDOR_FINAL') {
    throw AppError.badRequest(
      'CONDICION_IVA_INVALIDA',
      'Un cliente con DNI sólo puede tener condición IVA Consumidor Final.',
    );
  }
  if (tipoDocumento === 'CUIT' && input.condicion_iva === 'CONSUMIDOR_FINAL') {
    throw AppError.badRequest(
      'CONDICION_IVA_INVALIDA',
      'Un cliente con CUIT no puede tener condición IVA Consumidor Final (elegí Responsable Inscripto, Monotributo o Exento).',
    );
  }
  const limiteCredito = input.limite_credito ?? 0;
  if (limiteCredito < 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'limite_credito no puede ser negativo.');
  }

  const { rows } = await pool.query<Cliente>(
    `INSERT INTO clientes (nombre, tipo_documento, numero_documento, condicion_iva, limite_credito, id_zona, direccion, telefono, email)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${COLUMNAS_CLIENTE}`,
    [
      nombre,
      tipoDocumento,
      numeroDocumento,
      input.condicion_iva,
      limiteCredito,
      input.id_zona ?? null,
      input.direccion?.trim() || null,
      input.telefono?.trim() || null,
      input.email?.trim() || null,
    ],
  );
  return rows[0];
}
