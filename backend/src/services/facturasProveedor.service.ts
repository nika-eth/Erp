import { pool, withTransaction } from '../config/db';
import { AppError } from '../utils/AppError';
import { redondearMoneda } from '../utils/documento.utils';
import { obtenerIdCuentaPorCodigo } from './planCuentas.service';
import type { CrearFacturaProveedorInput, EstadoFacturaProveedor, FacturaProveedor, MonedaSoportada } from '../types/domain';

const CUENTA_COMPRAS = '5.2.01';
const CUENTA_IVA_CREDITO_FISCAL = '1.2.01';
const CUENTA_PROVEEDORES = '2.1.01';

const MONEDAS_VALIDAS: MonedaSoportada[] = ['ARS', 'USD'];
const TIPOS_COMPROBANTE_VALIDOS = ['FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'FACTURA_M'];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

const COLUMNAS_FACTURA = `id_factura_proveedor, id_proveedor, tipo_comprobante, punto_venta, nro_comprobante,
  fecha_emision, fecha_vencimiento, moneda, cotizacion, importe_neto, importe_iva, importe_total, saldo_pendiente, estado`;

export async function buscarFacturaProveedorPorId(id_factura_proveedor: number): Promise<FacturaProveedor> {
  const { rows } = await pool.query<FacturaProveedor>(
    `SELECT ${COLUMNAS_FACTURA} FROM facturas_proveedor WHERE id_factura_proveedor = $1`,
    [id_factura_proveedor],
  );
  const factura = rows[0];
  if (!factura) {
    throw AppError.notFound('FACTURA_PROVEEDOR_NO_ENCONTRADA', `No existe la factura id_factura_proveedor=${id_factura_proveedor}`);
  }
  return factura;
}

/** Listado filtrable por proveedor y/o estado — usado por el futuro buscador de imputación de la Orden de Pago. */
export async function buscarFacturasProveedor(id_proveedor?: number, estado?: EstadoFacturaProveedor): Promise<FacturaProveedor[]> {
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
  const { rows } = await pool.query<FacturaProveedor>(
    `SELECT ${COLUMNAS_FACTURA} FROM facturas_proveedor ${where} ORDER BY fecha_emision DESC LIMIT 50`,
    valores,
  );
  return rows;
}

/**
 * Alta de factura de proveedor + asiento automático de Provisión de Pasivo
 * (Debe Compras + Debe IVA Crédito Fiscal, Haber Proveedores), todo en una
 * misma transacción — el devengado contable ocurre al recibir la factura,
 * no al pagarla (ver `ordenesPago.service.ts` para la Cancelación).
 * `importe_total` nunca se toma del cliente: se recalcula server-side como
 * `importe_neto + importe_iva` (mismo criterio de no confiar en valores
 * derivados que ya usa `ventas.service.ts` -> `calcularItems`).
 * `saldo_pendiente` arranca en el total y lo va a ir descontando
 * `ordenesPago.service.ts::emitirOrdenPago`, no un trigger. Los montos del
 * asiento van convertidos a ARS (`monto * cotizacion`): el Libro Diario es
 * un único libro en ARS, independiente de la moneda del comprobante.
 */
export async function crearFacturaProveedor(input: CrearFacturaProveedorInput, id_usuario_carga: number): Promise<FacturaProveedor> {
  if (!Number.isInteger(input.id_proveedor) || input.id_proveedor <= 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'id_proveedor es requerido.');
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
  if (input.fecha_vencimiento && !FECHA_RE.test(input.fecha_vencimiento)) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'fecha_vencimiento debe tener formato YYYY-MM-DD.');
  }
  const moneda = input.moneda ?? 'ARS';
  if (!MONEDAS_VALIDAS.includes(moneda)) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'moneda debe ser ARS o USD.');
  }
  let cotizacion = 1;
  if (moneda === 'USD') {
    if (typeof input.cotizacion !== 'number' || Number.isNaN(input.cotizacion) || input.cotizacion <= 0) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'Para una factura en USD, cotizacion es requerida y debe ser mayor a 0.');
    }
    cotizacion = input.cotizacion;
  }
  if (typeof input.importe_neto !== 'number' || Number.isNaN(input.importe_neto) || input.importe_neto < 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'importe_neto debe ser un número mayor o igual a 0.');
  }
  const importeIva = input.importe_iva ?? 0;
  if (typeof importeIva !== 'number' || Number.isNaN(importeIva) || importeIva < 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'importe_iva debe ser un número mayor o igual a 0.');
  }
  const importeTotal = redondearMoneda(input.importe_neto + importeIva);

  return withTransaction(async (client) => {
    const { rows } = await client.query<FacturaProveedor>(
      `INSERT INTO facturas_proveedor
         (id_proveedor, tipo_comprobante, punto_venta, nro_comprobante, fecha_emision, fecha_vencimiento,
          moneda, cotizacion, importe_neto, importe_iva, importe_total, saldo_pendiente, id_usuario_carga)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12)
       RETURNING ${COLUMNAS_FACTURA}`,
      [
        input.id_proveedor,
        input.tipo_comprobante,
        input.punto_venta,
        input.nro_comprobante,
        input.fecha_emision,
        input.fecha_vencimiento ?? null,
        moneda,
        cotizacion,
        input.importe_neto,
        importeIva,
        importeTotal,
        id_usuario_carga,
      ],
    );
    const factura = rows[0];

    const [idCompras, idIvaCreditoFiscal, idProveedores] = await Promise.all([
      obtenerIdCuentaPorCodigo(client, CUENTA_COMPRAS),
      obtenerIdCuentaPorCodigo(client, CUENTA_IVA_CREDITO_FISCAL),
      obtenerIdCuentaPorCodigo(client, CUENTA_PROVEEDORES),
    ]);

    const { rows: asientoRows } = await client.query<{ id_asiento: number }>(
      `INSERT INTO asientos_contables (concepto, id_factura_proveedor, id_usuario)
       VALUES ($1, $2, $3) RETURNING id_asiento`,
      [`Provisión de pasivo - Factura ${input.tipo_comprobante} ${input.punto_venta}-${input.nro_comprobante}`, factura.id_factura_proveedor, id_usuario_carga],
    );
    const idAsiento = asientoRows[0].id_asiento;

    const importeNetoArs = redondearMoneda(input.importe_neto * cotizacion);
    const importeIvaArs = redondearMoneda(importeIva * cotizacion);
    const importeTotalArs = redondearMoneda(importeTotal * cotizacion);

    if (importeNetoArs > 0) {
      await client.query(
        `INSERT INTO asientos_detalle (id_asiento, id_cuenta_contable, debe, haber) VALUES ($1, $2, $3, 0)`,
        [idAsiento, idCompras, importeNetoArs],
      );
    }
    if (importeIvaArs > 0) {
      await client.query(
        `INSERT INTO asientos_detalle (id_asiento, id_cuenta_contable, debe, haber) VALUES ($1, $2, $3, 0)`,
        [idAsiento, idIvaCreditoFiscal, importeIvaArs],
      );
    }
    await client.query(
      `INSERT INTO asientos_detalle (id_asiento, id_cuenta_contable, debe, haber) VALUES ($1, $2, 0, $3)`,
      [idAsiento, idProveedores, importeTotalArs],
    );

    return factura;
  });
}
