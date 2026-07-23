import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../config/db';
import { AppError } from '../utils/AppError';
import { DOCUMENTO_COLUMNAS_BASE, ETIQUETA_TIPO_DOCUMENTO, redondearMoneda, resolverCantidadUnidades } from '../utils/documento.utils';
import { tipoDocumentoVentaPorCliente } from '../utils/identificacion.utils';
import { type ContextoAcceso, verificarAccesoSucursal } from '../utils/autorizacion.utils';
import { buscarClientePorId } from './clientes.service';
import { obtenerComprobanteInterno, marcarComprobanteInternoFacturado } from './emision/comprobantesInternos.repository';
import { emisorFiscalAfip } from './emision/emisorFiscalAfip';
import { emisorInterno } from './emision/emisorInterno';
import type { EmisorComprobante } from './emision/emisorComprobante';
import { crearRemitosRegularizacion, recalcularEstadoDespacho } from './remitos.service';
import type {
  Cliente,
  CuentaEmpresa,
  Documento,
  FacturarComprobanteInternoResult,
  FacturarVentaInput,
  FacturarVentaResult,
  ItemDocumento,
  ItemInput,
  MovimientoCuentaCorriente,
  Producto,
  TipoDocumento,
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
    if (!Number.isInteger(item.id_producto) || item.id_producto <= 0) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'Cada ítem requiere id_producto válido.');
    }
    if (item.cantidad <= 0 || item.precio_unitario <= 0) {
      throw AppError.badRequest(
        'PAYLOAD_INVALIDO',
        `Ítem id_producto=${item.id_producto} inválido: cantidad y precio_unitario deben ser positivos.`,
      );
    }
  }
  for (const pago of input.pagos) {
    if (!Number.isInteger(pago.id_cuenta) || pago.monto <= 0) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'Cada pago requiere id_cuenta válido y monto positivo.');
    }
  }
}

/**
 * `descripcion`, `unidad_venta` y `peso_teorico_kg` se resuelven acá, no se
 * confía en lo que mande el cliente (ver `ItemInput`). `activo = FALSE` se
 * rechaza: un producto dado de baja no se puede seguir vendiendo.
 */
export async function obtenerProductos(ids: number[], client?: PoolClient): Promise<Map<number, Producto>> {
  const runner = client ?? pool;
  const { rows } = await runner.query<Producto>(
    `SELECT id_producto, sku, descripcion, unidad_venta, peso_teorico_kg, activo FROM productos WHERE id_producto = ANY($1::int[])`,
    [ids],
  );
  const mapa = new Map(rows.map((r) => [r.id_producto, r]));
  const faltantes = ids.filter((id) => !mapa.has(id));
  if (faltantes.length > 0) {
    throw AppError.badRequest('PRODUCTO_INVALIDO', `No existen los productos: ${faltantes.join(', ')}`);
  }
  const inactivos = rows.filter((r) => !r.activo).map((r) => r.sku);
  if (inactivos.length > 0) {
    throw AppError.badRequest('PRODUCTO_INACTIVO', `Producto(s) dado(s) de baja, no se pueden vender: ${inactivos.join(', ')}`);
  }
  return mapa;
}

/**
 * Calcula kilos y subtotal por ítem, y el total neto de la venta.
 *   KILO   -> subtotal = (cantidad * peso_teorico_kg) * precio_unitario ($/kg)
 *   UNIDAD -> subtotal = cantidad * precio_unitario ($/unidad)
 * `kilos` se calcula siempre igual en ambos modos: alimenta la capacidad de
 * camión en logística, sea o no el producto el que fija el precio de venta.
 */
export function calcularItems(input: ItemInput[], productos: Map<number, Producto>): { items: ItemDocumento[]; totalNeto: number } {
  const items: ItemDocumento[] = input.map((i) => {
    const producto = productos.get(i.id_producto)!;
    const pesoTeorico = Number(producto.peso_teorico_kg);
    const cantidad = resolverCantidadUnidades(i.cantidad, i.unidad_ingreso ?? 'U', pesoTeorico, producto.sku);
    const kilos = redondearMoneda(cantidad * pesoTeorico);
    const subtotal =
      producto.unidad_venta === 'KILO'
        ? redondearMoneda(kilos * i.precio_unitario)
        : redondearMoneda(cantidad * i.precio_unitario);
    return {
      id_producto: i.id_producto,
      sku: producto.sku,
      descripcion: producto.descripcion,
      unidad_venta: producto.unidad_venta,
      cantidad,
      peso_teorico_kg: pesoTeorico,
      kilos,
      precio_unitario: i.precio_unitario,
      subtotal,
      cantidad_despachada_total: 0,
    };
  });
  const totalNeto = redondearMoneda(items.reduce((acc, i) => acc + i.subtotal, 0));
  return { items, totalNeto };
}

/** Una fila por ítem en `documentos_detalles` (ver `sql/009_documentos_detalles.sql`). */
export async function insertarDetalles(client: PoolClient, id_documento: number, items: ItemDocumento[]): Promise<void> {
  for (const item of items) {
    await client.query(
      `INSERT INTO documentos_detalles (id_documento, id_producto, sku, descripcion, unidad_venta, cantidad, peso_teorico_kg, precio_unitario, subtotal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id_documento,
        item.id_producto,
        item.sku,
        item.descripcion,
        item.unidad_venta,
        item.cantidad,
        item.peso_teorico_kg,
        item.precio_unitario,
        item.subtotal,
      ],
    );
  }
}

export async function obtenerCuentasEmpresa(ids: number[], client: PoolClient): Promise<Map<number, CuentaEmpresa>> {
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

export interface ContextoFacturacion {
  id_sucursal: number;
  id_usuario: number;
}

/** Ver `verifySupervisorOverride`: presente cuando un supervisor autorizó saltear el límite de crédito. */
export interface SupervisorAutorizacion {
  id_supervisor: number;
  nombreSupervisor: string;
}

interface NucleoVentaResult {
  documento: Documento;
  movimientos: MovimientoCuentaCorriente[];
  montoExcedido: number;
  cliente: Cliente;
  tipoDocumento: Extract<TipoDocumento, 'FACTURA_A' | 'FACTURA_B'>;
  totalNeto: number;
  totalPagos: number;
}

/**
 * Parte agnóstica de una venta: cabecera del documento + desglose de pago
 * mixto en cuenta_corriente. Ni sabe ni le importa si el comprobante
 * resultante va a ser Fiscal o Interno — eso lo decide el `EmisorComprobante`
 * que invoque cada wrapper de más abajo (`facturarVentaFiscal` /
 * `emitirVentaInterna`), después de que esta función retorna.
 *
 * Orden de operaciones (importa para que los triggers de Postgres se
 * disparen correctamente):
 *   0. Si `supervisorAutorizacion` está presente, `SET LOCAL
 *      app.allow_credit_override = 'true'` — sólo vale dentro de esta
 *      transacción — para que el trigger de límite de crédito lo salte.
 *   1. INSERT en `documentos`      -> dispara el trigger que asigna nro_remito
 *      (bloquea sucursales_secuencias con ON CONFLICT DO UPDATE).
 *   2. INSERT del DEBE en `cuenta_corriente` por el total de la venta
 *      -> dispara el trigger que valida limite_credito. Si lo excede y no
 *      hubo override, Postgres aborta la transacción entera (incluido el
 *      paso 1) y el catch de más abajo hace ROLLBACK; el controller
 *      traduce el error del trigger a un 422 con código
 *      LIMITE_CREDITO_EXCEDIDO.
 *   3. Si hubo override, INSERT en `auditoria_autorizaciones` dejando
 *      registrado qué supervisor autorizó y por cuánto se excedía.
 *   4. INSERT de un HABER en `cuenta_corriente` por cada medio de pago
 *      cargado por el vendedor.
 */
async function crearVentaSinEmitir(
  client: PoolClient,
  contexto: ContextoFacturacion,
  input: FacturarVentaInput,
  esFiscal: boolean,
  supervisorAutorizacion?: SupervisorAutorizacion | null,
): Promise<NucleoVentaResult> {
  if (supervisorAutorizacion) {
    await client.query(`SET LOCAL app.allow_credit_override = 'true'`);
  }

  const cliente = await buscarClientePorId(input.cliente_id, client);
  const tipoDocumento = tipoDocumentoVentaPorCliente(cliente.tipo_documento);
  const productos = await obtenerProductos(
    input.items.map((i) => i.id_producto),
    client,
  );
  const { items, totalNeto } = calcularItems(input.items, productos);

  const totalPagos = redondearMoneda(input.pagos.reduce((acc, p) => acc + p.monto, 0));
  if (totalPagos > totalNeto) {
    throw AppError.badRequest(
      'PAGO_EXCEDE_TOTAL',
      `La suma de los pagos (${totalPagos}) no puede superar el total de la venta (${totalNeto}).`,
    );
  }

  const cuentasEmpresa = await obtenerCuentasEmpresa(
    input.pagos.map((p) => p.id_cuenta),
    client,
  );

  const { rows: documentoRows } = await client.query<Documento>(
    `INSERT INTO documentos (id_sucursal_origen, fecha, cliente_id, total_neto, tipo_documento, id_zona, es_fiscal)
     VALUES ($1, NOW(), $2, $3, $4, $5, $6)
     RETURNING ${DOCUMENTO_COLUMNAS_BASE}`,
    [contexto.id_sucursal, input.cliente_id, totalNeto, tipoDocumento, cliente.id_zona, esFiscal],
  );
  const documento: Documento = { ...documentoRows[0], items };
  await insertarDetalles(client, documento.id_documento, items);

  let montoExcedido = 0;
  if (supervisorAutorizacion) {
    const { rows: saldoRows } = await client.query<{ saldo: string }>(
      `SELECT COALESCE(SUM(debe) - SUM(haber), 0) AS saldo FROM cuenta_corriente WHERE cliente_id = $1`,
      [input.cliente_id],
    );
    const saldoActual = Number(saldoRows[0].saldo);
    montoExcedido = redondearMoneda(Math.max(0, saldoActual + totalNeto - Number(cliente.limite_credito)));
  }

  const movimientos: MovimientoCuentaCorriente[] = [];

  const { rows: debeRows } = await client.query<MovimientoCuentaCorriente>(
    `INSERT INTO cuenta_corriente (cliente_id, fecha, debe, haber, id_documento, concepto)
     VALUES ($1, NOW(), $2, 0, $3, $4)
     RETURNING id_movimiento, cliente_id, fecha, debe, haber, id_documento, id_cuenta, id_recibo, concepto`,
    [input.cliente_id, totalNeto, documento.id_documento, `Venta ${ETIQUETA_TIPO_DOCUMENTO[tipoDocumento]} - Remito ${documento.nro_remito}`],
  );
  movimientos.push(debeRows[0]);

  if (supervisorAutorizacion) {
    await client.query(
      `INSERT INTO auditoria_autorizaciones (id_usuario_vendedor, id_supervisor, id_cliente, monto_excedido, fecha)
       VALUES ($1, $2, $3, $4, NOW())`,
      [contexto.id_usuario, supervisorAutorizacion.id_supervisor, input.cliente_id, montoExcedido],
    );
  }

  for (const pago of input.pagos) {
    const cuenta = cuentasEmpresa.get(pago.id_cuenta)!;
    const { rows: haberRows } = await client.query<MovimientoCuentaCorriente>(
      `INSERT INTO cuenta_corriente (cliente_id, fecha, debe, haber, id_documento, id_cuenta, concepto)
       VALUES ($1, NOW(), 0, $2, $3, $4, $5)
       RETURNING id_movimiento, cliente_id, fecha, debe, haber, id_documento, id_cuenta, id_recibo, concepto`,
      [input.cliente_id, pago.monto, documento.id_documento, pago.id_cuenta, `Pago ${cuenta.nombre_cuenta} - Remito ${documento.nro_remito}`],
    );
    movimientos.push(haberRows[0]);
  }

  return { documento, movimientos, montoExcedido, cliente, tipoDocumento, totalNeto, totalPagos };
}

async function facturar(
  contexto: ContextoFacturacion,
  input: FacturarVentaInput,
  esFiscal: boolean,
  emisor: EmisorComprobante,
  supervisorAutorizacion?: SupervisorAutorizacion | null,
): Promise<FacturarVentaResult> {
  validarPayload(input);

  return withTransaction(async (client) => {
    const nucleo = await crearVentaSinEmitir(client, contexto, input, esFiscal, supervisorAutorizacion);

    const resultadoEmision = await emisor.emitir(client, {
      id_documento: nucleo.documento.id_documento,
      nro_remito: nucleo.documento.nro_remito,
      tipo_documento: nucleo.tipoDocumento,
      total_neto: nucleo.totalNeto,
      cliente: nucleo.cliente,
    });
    const documento: Documento = { ...nucleo.documento, ...resultadoEmision };

    return {
      documento,
      saldo_pendiente: redondearMoneda(nucleo.totalNeto - nucleo.totalPagos),
      movimientos: nucleo.movimientos,
      autorizacion: supervisorAutorizacion
        ? { supervisor: supervisorAutorizacion.nombreSupervisor, monto_excedido: nucleo.montoExcedido }
        : undefined,
    };
  });
}

/**
 * POST /api/ventas/facturar-fiscal — Operación FISCAL: pide CAE a AFIP
 * (`emisorFiscalAfip`, único punto que habla con el Web Service).
 */
export async function facturarVentaFiscal(
  contexto: ContextoFacturacion,
  input: FacturarVentaInput,
  supervisorAutorizacion?: SupervisorAutorizacion | null,
): Promise<FacturarVentaResult> {
  return facturar(contexto, input, true, emisorFiscalAfip, supervisorAutorizacion);
}

/**
 * POST /api/ventas/emitir-interno — Operación INTERNA: nunca toca AFIP
 * (`emisorInterno`, cero imports de `src/afip/**`, verificado en CI).
 */
export async function emitirVentaInterna(
  contexto: ContextoFacturacion,
  input: FacturarVentaInput,
  supervisorAutorizacion?: SupervisorAutorizacion | null,
): Promise<FacturarVentaResult> {
  return facturar(contexto, input, false, emisorInterno, supervisorAutorizacion);
}

/**
 * Convierte un Comprobante Interno (CI, `es_fiscal:false`) en una Factura
 * fiscal A/B, para cuando el cliente necesita el comprobante legal después
 * de haber recibido la mercadería con un Remito X. NO genera nuevos
 * movimientos de `cuenta_corriente`: el DEBE de la venta y los HABER de los
 * pagos ya quedaron asentados cuando se creó el CI original — la Factura
 * nueva es sólo el papel fiscal/AFIP que lo reemplaza, enlazado por
 * `id_documento_origen_ci`.
 *
 * Por cada Remito X no anulado del CI, `crearRemitosRegularizacion` emite un
 * Remito R gemelo (`es_regularizacion_stock:true`) SIN volver a descontar
 * stock — la mercadería ya salió físicamente con el X (ver
 * `remitos.service.ts`). También copia `cantidad_despachada_total` del CI a
 * la Factura nueva, para que el saldo pendiente de despacho no se resetee.
 */
export async function facturarComprobanteInterno(
  id_documento_ci: number,
  contexto: ContextoAcceso,
): Promise<FacturarComprobanteInternoResult> {
  return withTransaction(async (client) => {
    const { rows: ciRows } = await client.query<{
      id_documento: number;
      id_sucursal_origen: number;
      cliente_id: number;
      total_neto: string;
      tipo_documento: TipoDocumento;
      id_zona: number | null;
      es_fiscal: boolean;
    }>(
      `SELECT id_documento, id_sucursal_origen, cliente_id, total_neto, tipo_documento, id_zona, es_fiscal
       FROM documentos WHERE id_documento = $1 FOR UPDATE`,
      [id_documento_ci],
    );
    const ci = ciRows[0];
    if (!ci) {
      throw AppError.notFound('DOCUMENTO_NO_ENCONTRADO', `No existe el documento id_documento=${id_documento_ci}`);
    }
    verificarAccesoSucursal(contexto, ci.id_sucursal_origen);
    if (ci.es_fiscal) {
      throw AppError.badRequest('DOCUMENTO_YA_FISCAL', 'El documento ya es una Factura fiscal, no es un Comprobante Interno.');
    }
    const comprobanteInterno = await obtenerComprobanteInterno(client, ci.id_documento);
    if (comprobanteInterno?.estado_facturacion_interna === 'FACTURADA') {
      throw AppError.conflict('YA_FACTURADO', 'Este Comprobante Interno ya fue facturado fiscalmente.');
    }

    const cliente = await buscarClientePorId(ci.cliente_id, client);
    const tipoDocumentoFactura = ci.tipo_documento as 'FACTURA_A' | 'FACTURA_B';

    const { rows: nuevaRows } = await client.query<Documento>(
      `INSERT INTO documentos (id_sucursal_origen, fecha, cliente_id, total_neto, tipo_documento, id_zona, es_fiscal, id_documento_origen_ci)
       VALUES ($1, NOW(), $2, $3, $4, $5, TRUE, $6)
       RETURNING ${DOCUMENTO_COLUMNAS_BASE}`,
      [ci.id_sucursal_origen, ci.cliente_id, ci.total_neto, ci.tipo_documento, ci.id_zona, ci.id_documento],
    );
    let documento: Documento = { ...nuevaRows[0], items: [] };

    const { rows: itemsCi } = await client.query<ItemDocumento & { cantidad_despachada_total: string }>(
      `SELECT id_producto, sku, descripcion, unidad_venta, cantidad, peso_teorico_kg, precio_unitario, subtotal,
              cantidad_despachada_total
       FROM documentos_detalles WHERE id_documento = $1`,
      [ci.id_documento],
    );
    const items: ItemDocumento[] = itemsCi.map((i) => ({
      id_producto: i.id_producto,
      sku: i.sku,
      descripcion: i.descripcion,
      unidad_venta: i.unidad_venta,
      cantidad: Number(i.cantidad),
      peso_teorico_kg: Number(i.peso_teorico_kg),
      kilos: redondearMoneda(Number(i.cantidad) * Number(i.peso_teorico_kg)),
      precio_unitario: Number(i.precio_unitario),
      subtotal: Number(i.subtotal),
      cantidad_despachada_total: Number(i.cantidad_despachada_total),
    }));
    await insertarDetalles(client, documento.id_documento, items);
    await client.query(
      `UPDATE documentos_detalles dd SET cantidad_despachada_total = ci_dd.cantidad_despachada_total
       FROM documentos_detalles ci_dd
       WHERE dd.id_documento = $1 AND ci_dd.id_documento = $2 AND dd.id_producto = ci_dd.id_producto`,
      [documento.id_documento, ci.id_documento],
    );
    documento = { ...documento, items };

    const remitosRegularizacion = await crearRemitosRegularizacion(client, {
      id_documento_ci: ci.id_documento,
      id_documento_factura: documento.id_documento,
      cliente_id: ci.cliente_id,
      id_sucursal: ci.id_sucursal_origen,
    });

    await recalcularEstadoDespacho(client, documento.id_documento);

    await marcarComprobanteInternoFacturado(client, ci.id_documento);

    const resultadoEmision = await emisorFiscalAfip.emitir(client, {
      id_documento: documento.id_documento,
      nro_remito: documento.nro_remito,
      tipo_documento: tipoDocumentoFactura,
      total_neto: Number(ci.total_neto),
      cliente,
    });
    documento = { ...documento, ...resultadoEmision, items };

    return { documento, remitos_regularizacion: remitosRegularizacion };
  });
}

/**
 * Guarda un Presupuesto: sólo cabecera en `documentos` + sus ítems en
 * `documentos_detalles`, sin movimientos en cuenta_corriente. Según la
 * regla de negocio, el presupuesto no viaja a AFIP, no descuenta stock y no
 * debería consumir la numeración correlativa de remitos de venta (eso
 * depende de cómo el trigger de la base trate el `tipo_documento =
 * 'PRESUPUESTO'` sobre `sucursales_secuencias`). Transaccional porque ahora
 * son dos tablas (cabecera + detalle), no un solo INSERT atómico.
 */
export async function guardarPresupuesto(
  id_sucursal: number,
  input: Pick<FacturarVentaInput, 'cliente_id' | 'items'>,
): Promise<Documento> {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'El presupuesto debe tener al menos un ítem.');
  }
  await buscarClientePorId(input.cliente_id);
  const productos = await obtenerProductos(input.items.map((i) => i.id_producto));
  const { items, totalNeto } = calcularItems(input.items, productos);

  return withTransaction(async (client) => {
    const { rows } = await client.query<Documento>(
      `INSERT INTO documentos (id_sucursal_origen, fecha, cliente_id, total_neto, tipo_documento)
       VALUES ($1, NOW(), $2, $3, 'PRESUPUESTO')
       RETURNING ${DOCUMENTO_COLUMNAS_BASE}`,
      [id_sucursal, input.cliente_id, totalNeto],
    );
    const documento: Documento = { ...rows[0], items };
    await insertarDetalles(client, documento.id_documento, items);
    return documento;
  });
}
