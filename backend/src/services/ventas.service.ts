import type { PoolClient } from 'pg';
import { calcularNetoEIva, solicitarCaeParaDocumento } from '../afip/afip.service';
import { encolarContingencia } from '../afip/cola.repository';
import { docTipoAfip, TIPO_COMPROBANTE_AFIP, TIPO_COMPROBANTE_REMITO_INTERNO } from '../afip/types';
import { env } from '../config/env';
import { pool, withTransaction } from '../config/db';
import { AppError } from '../utils/AppError';
import { DOCUMENTO_COLUMNAS, ETIQUETA_TIPO_DOCUMENTO, redondearMoneda } from '../utils/documento.utils';
import { tipoDocumentoVentaPorCliente } from '../utils/identificacion.utils';
import { buscarClientePorId } from './clientes.service';
import type {
  CuentaEmpresa,
  Documento,
  EstadoAfip,
  FacturarVentaInput,
  FacturarVentaResult,
  ItemDocumento,
  ItemInput,
  MovimientoCuentaCorriente,
  Producto,
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
async function obtenerProductos(ids: number[], client?: PoolClient): Promise<Map<number, Producto>> {
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
function calcularItems(input: ItemInput[], productos: Map<number, Producto>): { items: ItemDocumento[]; totalNeto: number } {
  const items: ItemDocumento[] = input.map((i) => {
    const producto = productos.get(i.id_producto)!;
    const pesoTeorico = Number(producto.peso_teorico_kg);
    const kilos = redondearMoneda(i.cantidad * pesoTeorico);
    const subtotal =
      producto.unidad_venta === 'KILO'
        ? redondearMoneda(kilos * i.precio_unitario)
        : redondearMoneda(i.cantidad * i.precio_unitario);
    return {
      id_producto: i.id_producto,
      sku: producto.sku,
      descripcion: producto.descripcion,
      unidad_venta: producto.unidad_venta,
      cantidad: i.cantidad,
      peso_teorico_kg: pesoTeorico,
      kilos,
      precio_unitario: i.precio_unitario,
      subtotal,
    };
  });
  const totalNeto = redondearMoneda(items.reduce((acc, i) => acc + i.subtotal, 0));
  return { items, totalNeto };
}

/** Una fila por ítem en `documentos_detalles` (ver `sql/009_documentos_detalles.sql`). */
async function insertarDetalles(client: PoolClient, id_documento: number, items: ItemDocumento[]): Promise<void> {
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

export interface ContextoFacturacion {
  id_sucursal: number;
  id_usuario: number;
}

/** Ver `verifySupervisorOverride`: presente cuando un supervisor autorizó saltear el límite de crédito. */
export interface SupervisorAutorizacion {
  id_supervisor: number;
  nombreSupervisor: string;
}

/**
 * Procesa una venta completa: cabecera del documento + desglose de pago
 * mixto en cuenta_corriente, dentro de una única transacción.
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
export async function facturarVenta(
  contexto: ContextoFacturacion,
  input: FacturarVentaInput,
  supervisorAutorizacion?: SupervisorAutorizacion | null,
): Promise<FacturarVentaResult> {
  validarPayload(input);

  const cliente = await buscarClientePorId(input.cliente_id);
  const tipo_documento = tipoDocumentoVentaPorCliente(cliente.tipo_documento);
  const productos = await obtenerProductos(input.items.map((i) => i.id_producto));
  const { items, totalNeto } = calcularItems(input.items, productos);

  const totalPagos = redondearMoneda(input.pagos.reduce((acc, p) => acc + p.monto, 0));
  if (totalPagos > totalNeto) {
    throw AppError.badRequest(
      'PAGO_EXCEDE_TOTAL',
      `La suma de los pagos (${totalPagos}) no puede superar el total de la venta (${totalNeto}).`,
    );
  }

  return withTransaction(async (client) => {
    if (supervisorAutorizacion) {
      await client.query(`SET LOCAL app.allow_credit_override = 'true'`);
    }

    const cuentasEmpresa = await obtenerCuentasEmpresa(
      input.pagos.map((p) => p.id_cuenta),
      client,
    );

    // Elegido por el vendedor en Rendición de Pago (F5 fiscal / F6 interno,
    // ver RendicionPago.tsx). `es_fiscal: false` NUNCA toca AFIP: se resuelve
    // por completo acá adentro, sin cola de contingencia.
    const esFiscal = input.es_fiscal !== false;
    const tipoComprobante = esFiscal ? TIPO_COMPROBANTE_AFIP[tipo_documento] : TIPO_COMPROBANTE_REMITO_INTERNO;
    const puntoVentaDocumento = esFiscal ? env.afip.puntoVenta : env.afip.puntoVentaInterno;
    const estadoAfipInicial: EstadoAfip = esFiscal ? 'PENDIENTE' : 'APROBADO_INTERNO';

    const { rows: documentoRows } = await client.query<Documento>(
      `INSERT INTO documentos (id_sucursal_origen, fecha, cliente_id, total_neto, tipo_documento, id_zona, es_fiscal, tipo_comprobante, punto_venta, estado_afip)
       VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${DOCUMENTO_COLUMNAS}`,
      [
        contexto.id_sucursal,
        input.cliente_id,
        totalNeto,
        tipo_documento,
        cliente.id_zona,
        esFiscal,
        tipoComprobante,
        puntoVentaDocumento,
        estadoAfipInicial,
      ],
    );
    let documento: Documento = { ...documentoRows[0], items };
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
      [
        input.cliente_id,
        totalNeto,
        documento.id_documento,
        `Venta ${ETIQUETA_TIPO_DOCUMENTO[tipo_documento]} - Remito ${documento.nro_remito}`,
      ],
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

    // Intento de facturación electrónica (AFIP WSFE) — SÓLO para ventas
    // fiscales. Deliberadamente DESPUÉS de que la venta ya está armada en
    // esta misma transacción, y ANTES del COMMIT: si AFIP falla, la venta
    // igual se confirma (queda en CONTINGENCIA); `solicitarCaeParaDocumento`
    // nunca lanza, así que esto jamás puede hacer abortar la transacción de
    // venta. Ver `src/afip/afip.service.ts` para el detalle del contrato.
    // Una venta interna (`esFiscal = false`) ya quedó resuelta en el INSERT
    // de arriba (`estado_afip = 'APROBADO_INTERNO'`): no hay nada más que
    // hacer acá.
    if (esFiscal) {
      const { neto, iva } = calcularNetoEIva(totalNeto);
      const resultadoAfip = await solicitarCaeParaDocumento(client, {
        id_documento: documento.id_documento,
        puntoVenta: puntoVentaDocumento,
        tipoComprobante,
        docTipo: docTipoAfip(cliente.tipo_documento),
        docNro: cliente.numero_documento,
        importeTotal: totalNeto,
        importeNeto: neto,
        importeIva: iva,
        nroComprobanteAfipPrevio: null,
      });

      if (resultadoAfip.ok) {
        const { rows } = await client.query<Documento>(
          `UPDATE documentos SET cae = $1, cae_vencimiento = $2, estado_afip = 'APROBADO'
           WHERE id_documento = $3 RETURNING ${DOCUMENTO_COLUMNAS}`,
          [resultadoAfip.cae, resultadoAfip.caeVencimiento, documento.id_documento],
        );
        documento = { ...rows[0], items };
      } else {
        const { rows } = await client.query<Documento>(
          `UPDATE documentos SET estado_afip = $1, error_afip_mensaje = $2
           WHERE id_documento = $3 RETURNING ${DOCUMENTO_COLUMNAS}`,
          [resultadoAfip.tipo, resultadoAfip.mensaje, documento.id_documento],
        );
        documento = { ...rows[0], items };
        if (resultadoAfip.tipo === 'CONTINGENCIA') {
          await encolarContingencia(client, documento.id_documento);
        }
      }
    }

    return {
      documento,
      saldo_pendiente: redondearMoneda(totalNeto - totalPagos),
      movimientos,
      autorizacion: supervisorAutorizacion
        ? { supervisor: supervisorAutorizacion.nombreSupervisor, monto_excedido: montoExcedido }
        : undefined,
    };
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
       RETURNING ${DOCUMENTO_COLUMNAS}`,
      [id_sucursal, input.cliente_id, totalNeto],
    );
    const documento: Documento = { ...rows[0], items };
    await insertarDetalles(client, documento.id_documento, items);
    return documento;
  });
}
