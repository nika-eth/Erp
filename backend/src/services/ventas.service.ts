import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../config/db';
import { AppError } from '../utils/AppError';
import { ETIQUETA_TIPO_DOCUMENTO, redondearMoneda, tipoDocumentoPorIdentificacion } from '../utils/documento.utils';
import { buscarClientePorId } from './clientes.service';
import type {
  CuentaEmpresa,
  Documento,
  FacturarVentaInput,
  FacturarVentaResult,
  ItemDocumento,
  MovimientoCuentaCorriente,
} from '../types/domain';

/** Valida la forma del payload antes de tocar la base de datos. */
function validarPayload(input: FacturarVentaInput): void {
  if (!Number.isInteger(input.cliente_id) || input.cliente_id <= 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'cliente_id es requerido y debe ser un entero positivo.');
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'La venta debe tener al menos un ítem.');
  }
  if (!Array.isArray(input.pagos) || input.pagos.length === 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'La venta debe tener al menos un medio de pago cargado.');
  }
  for (const item of input.items) {
    if (item.cantidad <= 0 || item.peso_teorico_kg <= 0 || item.precio_unitario <= 0) {
      throw AppError.badRequest(
        'PAYLOAD_INVALIDO',
        `Ítem "${item.descripcion}" inválido: cantidad, peso_teorico_kg y precio_unitario deben ser positivos.`,
      );
    }
  }
  for (const pago of input.pagos) {
    if (!Number.isInteger(pago.id_cuenta) || pago.monto <= 0) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'Cada pago requiere id_cuenta válido y monto positivo.');
    }
  }
}

/** Calcula kilos y subtotal por ítem, y el total neto de la venta. */
function calcularItems(input: FacturarVentaInput['items']): { items: ItemDocumento[]; totalNeto: number } {
  const items: ItemDocumento[] = input.map((i) => {
    const kilos = redondearMoneda(i.cantidad * i.peso_teorico_kg);
    const subtotal = redondearMoneda(kilos * i.precio_unitario);
    return {
      id_material: i.id_material,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      peso_teorico_kg: i.peso_teorico_kg,
      kilos,
      precio_unitario: i.precio_unitario,
      subtotal,
    };
  });
  const totalNeto = redondearMoneda(items.reduce((acc, i) => acc + i.subtotal, 0));
  return { items, totalNeto };
}

async function obtenerCuentasEmpresa(ids: number[], client: PoolClient): Promise<Map<number, CuentaEmpresa>> {
  const { rows } = await client.query<CuentaEmpresa>(
    `SELECT id_cuenta, nombre_cuenta FROM cuentas_empresa WHERE id_cuenta = ANY($1::int[])`,
    [ids],
  );
  const mapa = new Map(rows.map((r) => [r.id_cuenta, r]));
  const faltantes = ids.filter((id) => !mapa.has(id));
  if (faltantes.length > 0) {
    throw AppError.badRequest(
      'CUENTA_EMPRESA_INVALIDA',
      `No existen las cuentas de cobro: ${faltantes.join(', ')}`,
    );
  }
  return mapa;
}

/**
 * Procesa una venta completa: cabecera del documento + desglose de pago
 * mixto en cuenta_corriente, dentro de una única transacción.
 *
 * Orden de operaciones (importa para que los triggers de Postgres se
 * disparen correctamente):
 *   1. INSERT en `documentos`      -> dispara el trigger que asigna nro_remito
 *      (bloquea sucursales_secuencias con ON CONFLICT DO UPDATE).
 *   2. INSERT del DEBE en `cuenta_corriente` por el total de la venta
 *      -> dispara el trigger que valida limite_credito. Si lo excede,
 *      Postgres aborta la transacción entera (incluido el paso 1) y el
 *      catch de más abajo hace ROLLBACK; el controller traduce el error
 *      del trigger a un 422 con código LIMITE_CREDITO_EXCEDIDO.
 *   3. INSERT de un HABER en `cuenta_corriente` por cada medio de pago
 *      cargado por el vendedor.
 */
export async function facturarVenta(
  id_sucursal: number,
  input: FacturarVentaInput,
): Promise<FacturarVentaResult> {
  validarPayload(input);

  const cliente = await buscarClientePorId(input.cliente_id);
  const tipo_documento = tipoDocumentoPorIdentificacion(cliente.cuit_dni);
  const { items, totalNeto } = calcularItems(input.items);

  const totalPagos = redondearMoneda(input.pagos.reduce((acc, p) => acc + p.monto, 0));
  if (totalPagos > totalNeto) {
    throw AppError.badRequest(
      'PAGO_EXCEDE_TOTAL',
      `La suma de los pagos (${totalPagos}) no puede superar el total de la venta (${totalNeto}).`,
    );
  }

  return withTransaction(async (client) => {
    const cuentasEmpresa = await obtenerCuentasEmpresa(
      input.pagos.map((p) => p.id_cuenta),
      client,
    );

    const { rows: documentoRows } = await client.query<Documento>(
      `INSERT INTO documentos (id_sucursal_origen, fecha, cliente_id, total_neto, tipo_documento, items)
       VALUES ($1, NOW(), $2, $3, $4, $5::jsonb)
       RETURNING id_documento, id_sucursal_origen, nro_remito, fecha, cliente_id, total_neto, tipo_documento, items`,
      [id_sucursal, input.cliente_id, totalNeto, tipo_documento, JSON.stringify(items)],
    );
    const documento = documentoRows[0];

    const movimientos: MovimientoCuentaCorriente[] = [];

    const { rows: debeRows } = await client.query<MovimientoCuentaCorriente>(
      `INSERT INTO cuenta_corriente (cliente_id, fecha, debe, haber, id_documento, concepto)
       VALUES ($1, NOW(), $2, 0, $3, $4)
       RETURNING id_movimiento, cliente_id, fecha, debe, haber, id_documento, id_cuenta, concepto`,
      [
        input.cliente_id,
        totalNeto,
        documento.id_documento,
        `Venta ${ETIQUETA_TIPO_DOCUMENTO[tipo_documento]} - Remito ${documento.nro_remito}`,
      ],
    );
    movimientos.push(debeRows[0]);

    for (const pago of input.pagos) {
      const cuenta = cuentasEmpresa.get(pago.id_cuenta)!;
      const { rows: haberRows } = await client.query<MovimientoCuentaCorriente>(
        `INSERT INTO cuenta_corriente (cliente_id, fecha, debe, haber, id_documento, id_cuenta, concepto)
         VALUES ($1, NOW(), 0, $2, $3, $4, $5)
         RETURNING id_movimiento, cliente_id, fecha, debe, haber, id_documento, id_cuenta, concepto`,
        [
          input.cliente_id,
          pago.monto,
          documento.id_documento,
          pago.id_cuenta,
          `Pago ${cuenta.nombre_cuenta} - Remito ${documento.nro_remito}`,
        ],
      );
      movimientos.push(haberRows[0]);
    }

    return {
      documento,
      saldo_pendiente: redondearMoneda(totalNeto - totalPagos),
      movimientos,
    };
  });
}

/**
 * Guarda un Presupuesto: sólo cabecera en `documentos`, sin movimientos en
 * cuenta_corriente. Según la regla de negocio, el presupuesto no viaja a
 * AFIP, no descuenta stock y no debería consumir la numeración correlativa
 * de remitos de venta (eso depende de cómo el trigger de la base trate el
 * `tipo_documento = 'PRESUPUESTO'` sobre `sucursales_secuencias`).
 */
export async function guardarPresupuesto(
  id_sucursal: number,
  input: Pick<FacturarVentaInput, 'cliente_id' | 'items'>,
): Promise<Documento> {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'El presupuesto debe tener al menos un ítem.');
  }
  await buscarClientePorId(input.cliente_id);
  const { items, totalNeto } = calcularItems(input.items);

  const { rows } = await pool.query<Documento>(
    `INSERT INTO documentos (id_sucursal_origen, fecha, cliente_id, total_neto, tipo_documento, items)
     VALUES ($1, NOW(), $2, $3, 'PRESUPUESTO', $4::jsonb)
     RETURNING id_documento, id_sucursal_origen, nro_remito, fecha, cliente_id, total_neto, tipo_documento, items`,
    [id_sucursal, input.cliente_id, totalNeto, JSON.stringify(items)],
  );
  return rows[0];
}
