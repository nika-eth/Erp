import { pool } from '../config/db';
import { AppError } from '../utils/AppError';
import type {
  CrearNotaCreditoProveedorInput,
  EstadoNotaCreditoProveedor,
  MonedaSoportada,
  NotaCreditoProveedor,
} from '../types/domain';

const MONEDAS_VALIDAS: MonedaSoportada[] = ['ARS', 'USD'];
const TIPOS_COMPROBANTE_VALIDOS = ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C', 'NOTA_CREDITO_M'];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

const COLUMNAS_NC = `id_nota_credito_proveedor, id_proveedor, id_factura_proveedor, tipo_comprobante, punto_venta,
  nro_comprobante, fecha_emision, moneda, cotizacion, importe_total, saldo_disponible, estado`;

export async function buscarNotaCreditoProveedorPorId(id_nota_credito_proveedor: number): Promise<NotaCreditoProveedor> {
  const { rows } = await pool.query<NotaCreditoProveedor>(
    `SELECT ${COLUMNAS_NC} FROM notas_credito_proveedor WHERE id_nota_credito_proveedor = $1`,
    [id_nota_credito_proveedor],
  );
  const nc = rows[0];
  if (!nc) {
    throw AppError.notFound(
      'NOTA_CREDITO_PROVEEDOR_NO_ENCONTRADA',
      `No existe la nota de crédito id_nota_credito_proveedor=${id_nota_credito_proveedor}`,
    );
  }
  return nc;
}

/** Listado filtrable por proveedor y/o estado — usado por el futuro buscador de imputación de la Orden de Pago. */
export async function buscarNotasCreditoProveedor(
  id_proveedor?: number,
  estado?: EstadoNotaCreditoProveedor,
): Promise<NotaCreditoProveedor[]> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  if (id_proveedor !== undefined) {
    valores.push(id_proveedor);
    condiciones.push(`id_proveedor = $${valores.length}`);
  }
  if (estado !== undefined) {
    valores.push(estado);
    condiciones.push(`estado = $${valores.length}`);
  }

  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
  const { rows } = await pool.query<NotaCreditoProveedor>(
    `SELECT ${COLUMNAS_NC} FROM notas_credito_proveedor ${where} ORDER BY fecha_emision DESC LIMIT 50`,
    valores,
  );
  return rows;
}

/** `saldo_disponible` arranca en `importe_total` y lo va a ir descontando el servicio de imputación de OP. */
export async function crearNotaCreditoProveedor(
  input: CrearNotaCreditoProveedorInput,
  id_usuario_carga: number,
): Promise<NotaCreditoProveedor> {
  if (!Number.isInteger(input.id_proveedor) || input.id_proveedor <= 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'id_proveedor es requerido.');
  }
  if (input.id_factura_proveedor !== undefined && input.id_factura_proveedor !== null) {
    if (!Number.isInteger(input.id_factura_proveedor) || input.id_factura_proveedor <= 0) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'id_factura_proveedor debe ser un entero válido.');
    }
  }
  if (!TIPOS_COMPROBANTE_VALIDOS.includes(input.tipo_comprobante)) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', `tipo_comprobante debe ser uno de: ${TIPOS_COMPROBANTE_VALIDOS.join(', ')}.`);
  }
  if (!Number.isInteger(input.punto_venta) || input.punto_venta <= 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'punto_venta debe ser un entero mayor a 0.');
  }
  if (!Number.isInteger(input.nro_comprobante) || input.nro_comprobante <= 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'nro_comprobante debe ser un entero mayor a 0.');
  }
  if (!FECHA_RE.test(input.fecha_emision ?? '')) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'fecha_emision debe tener formato YYYY-MM-DD.');
  }
  const moneda = input.moneda ?? 'ARS';
  if (!MONEDAS_VALIDAS.includes(moneda)) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'moneda debe ser ARS o USD.');
  }
  let cotizacion = 1;
  if (moneda === 'USD') {
    if (typeof input.cotizacion !== 'number' || Number.isNaN(input.cotizacion) || input.cotizacion <= 0) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'Para una nota de crédito en USD, cotizacion es requerida y debe ser mayor a 0.');
    }
    cotizacion = input.cotizacion;
  }
  if (typeof input.importe_total !== 'number' || Number.isNaN(input.importe_total) || input.importe_total <= 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'importe_total debe ser un número mayor a 0.');
  }

  const { rows } = await pool.query<NotaCreditoProveedor>(
    `INSERT INTO notas_credito_proveedor
       (id_proveedor, id_factura_proveedor, tipo_comprobante, punto_venta, nro_comprobante, fecha_emision,
        moneda, cotizacion, importe_total, saldo_disponible, id_usuario_carga)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)
     RETURNING ${COLUMNAS_NC}`,
    [
      input.id_proveedor,
      input.id_factura_proveedor ?? null,
      input.tipo_comprobante,
      input.punto_venta,
      input.nro_comprobante,
      input.fecha_emision,
      moneda,
      cotizacion,
      input.importe_total,
      id_usuario_carga,
    ],
  );
  return rows[0];
}
