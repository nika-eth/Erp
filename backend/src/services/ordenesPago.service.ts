import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../config/db';
import { AppError } from '../utils/AppError';
import { redondearMoneda } from '../utils/documento.utils';
import { obtenerCotizacion } from './cotizaciones.service';
import { obtenerIdCuentaPorCodigo } from './planCuentas.service';
import type {
  AnularOrdenPagoInput,
  EmitirOrdenPagoInput,
  EmitirOrdenPagoResult,
  ImputacionOPInput,
  MedioPagoOPInput,
  MonedaSoportada,
  OpImputacion,
  OpMedioPago,
  OpRetencion,
  OrdenPago,
  RetencionOPInput,
  TipoImputacionOP,
  TipoMedioPagoOP,
  TipoRetencionOP,
} from '../types/domain';

const TIPOS_IMPUTACION_VALIDOS: TipoImputacionOP[] = ['FACTURA', 'NOTA_CREDITO', 'ANTICIPO'];
const TIPOS_RETENCION_VALIDOS: TipoRetencionOP[] = ['GANANCIAS', 'IVA', 'IIBB_ARBA', 'IIBB_OTRA_JURISDICCION', 'SUSS'];
const TIPOS_MEDIO_PAGO_VALIDOS: TipoMedioPagoOP[] = ['TRANSFERENCIA', 'CHEQUE', 'EFECTIVO'];
const MONEDAS_VALIDAS: MonedaSoportada[] = ['ARS', 'USD'];

/** Tolerancia para comparar montos en pesos, evita falsos rechazos por ruido de punto flotante. */
const EPSILON_MONTO = 0.01;

const CUENTA_PROVEEDORES = '2.1.01';
const CUENTA_ANTICIPOS_PROVEEDORES = '2.1.02';
const CUENTA_CAJA = '1.1.01';
const CUENTA_BANCO = '1.1.02';
const CUENTA_DIFERENCIA_CAMBIO_PERDIDA = '5.1.01';
const CUENTA_DIFERENCIA_CAMBIO_GANANCIA = '4.1.01';

const CUENTAS_RETENCION: Record<TipoRetencionOP, string> = {
  GANANCIAS: '2.2.01',
  IVA: '2.2.02',
  IIBB_ARBA: '2.2.03',
  IIBB_OTRA_JURISDICCION: '2.2.03',
  SUSS: '2.2.04',
};

const COLUMNAS_OP = `id_orden_pago, nro_op, id_proveedor, id_sucursal, fecha, moneda, total_facturas, total_notas_credito,
  total_anticipos, total_retenciones, neto_a_pagar, diferencia_cambio, estado, motivo_anulacion,
  id_usuario_anulo, fecha_anulacion, id_usuario_emitio`;

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function validarPayload(input: EmitirOrdenPagoInput): void {
  if (!Number.isInteger(input.id_proveedor) || input.id_proveedor <= 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'id_proveedor es requerido.');
  }
  if (input.moneda !== undefined && !MONEDAS_VALIDAS.includes(input.moneda)) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'moneda debe ser ARS o USD.');
  }
  if (!Array.isArray(input.imputaciones) || input.imputaciones.length === 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'La Orden de Pago debe imputar contra al menos un documento.');
  }
  for (const imputacion of input.imputaciones) {
    if (!TIPOS_IMPUTACION_VALIDOS.includes(imputacion.tipo)) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', `tipo de imputación inválido: ${imputacion.tipo}.`);
    }
    if (!Number.isInteger(imputacion.id) || imputacion.id <= 0) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'Cada imputación requiere un id válido.');
    }
    if (typeof imputacion.monto_imputado !== 'number' || Number.isNaN(imputacion.monto_imputado) || imputacion.monto_imputado <= 0) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'monto_imputado debe ser un número mayor a 0.');
    }
  }
  for (const retencion of input.retenciones ?? []) {
    if (!TIPOS_RETENCION_VALIDOS.includes(retencion.tipo_retencion)) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', `tipo_retencion inválido: ${retencion.tipo_retencion}.`);
    }
    if (typeof retencion.base_imponible !== 'number' || Number.isNaN(retencion.base_imponible) || retencion.base_imponible < 0) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'base_imponible debe ser un número mayor o igual a 0.');
    }
    if (typeof retencion.alicuota !== 'number' || Number.isNaN(retencion.alicuota) || retencion.alicuota < 0 || retencion.alicuota > 1) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'alicuota debe ser una fracción entre 0 y 1 (ej. 0.02 para 2%).');
    }
  }
  if (!Array.isArray(input.medios_pago) || input.medios_pago.length === 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'La Orden de Pago debe tener al menos un medio de pago.');
  }
  for (const medio of input.medios_pago) {
    if (!TIPOS_MEDIO_PAGO_VALIDOS.includes(medio.tipo)) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', `tipo de medio de pago inválido: ${medio.tipo}.`);
    }
    if (typeof medio.monto !== 'number' || Number.isNaN(medio.monto) || medio.monto <= 0) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'El monto de cada medio de pago debe ser mayor a 0.');
    }
  }
}

interface DocumentoImputable {
  id_proveedor: number;
  moneda: MonedaSoportada;
  cotizacion: string;
  saldo: string;
  estado: string;
}

/**
 * Bloquea (`FOR UPDATE`) y valida el documento imputado, descuenta su
 * saldo y actualiza su estado. Devuelve la cotización propia del
 * documento (la de cuando se lo cargó), necesaria para convertir a ARS al
 * valor histórico en el asiento de Cancelación.
 */
async function procesarImputacion(
  client: PoolClient,
  imputacion: ImputacionOPInput,
  id_proveedor: number,
  monedaOP: MonedaSoportada,
): Promise<number> {
  let tabla: string;
  let columnaId: string;
  let columnaSaldo: string;
  let estadoAnulado: string;
  let estadoTerminal: string;
  let etiqueta: string;

  if (imputacion.tipo === 'FACTURA') {
    tabla = 'facturas_proveedor';
    columnaId = 'id_factura_proveedor';
    columnaSaldo = 'saldo_pendiente';
    estadoAnulado = 'ANULADA';
    estadoTerminal = 'PAGADA';
    etiqueta = 'la factura';
  } else if (imputacion.tipo === 'NOTA_CREDITO') {
    tabla = 'notas_credito_proveedor';
    columnaId = 'id_nota_credito_proveedor';
    columnaSaldo = 'saldo_disponible';
    estadoAnulado = 'ANULADA';
    estadoTerminal = 'APLICADA';
    etiqueta = 'la nota de crédito';
  } else {
    tabla = 'anticipos_proveedor';
    columnaId = 'id_anticipo_proveedor';
    columnaSaldo = 'saldo_disponible';
    estadoAnulado = 'ANULADO';
    estadoTerminal = 'APLICADO';
    etiqueta = 'el anticipo';
  }

  const { rows } = await client.query<DocumentoImputable>(
    `SELECT id_proveedor, moneda, cotizacion, ${columnaSaldo} AS saldo, estado
     FROM ${tabla} WHERE ${columnaId} = $1 FOR UPDATE`,
    [imputacion.id],
  );
  const documento = rows[0];
  if (!documento) {
    throw AppError.notFound('IMPUTACION_NO_ENCONTRADA', `No existe ${etiqueta} con id=${imputacion.id}.`);
  }
  if (documento.id_proveedor !== id_proveedor) {
    throw AppError.badRequest('IMPUTACION_INVALIDA', `${etiqueta} id=${imputacion.id} no pertenece al proveedor indicado.`);
  }
  if (documento.moneda !== monedaOP) {
    throw AppError.badRequest(
      'IMPUTACION_INVALIDA',
      `${etiqueta} id=${imputacion.id} está en ${documento.moneda}, no coincide con la moneda de la Orden de Pago (${monedaOP}).`,
    );
  }
  if (documento.estado === estadoAnulado) {
    throw AppError.conflict('DOCUMENTO_ANULADO', `${etiqueta} id=${imputacion.id} está anulada/o.`);
  }
  const saldo = Number(documento.saldo);
  if (imputacion.monto_imputado > saldo + EPSILON_MONTO) {
    throw AppError.conflict('SALDO_INSUFICIENTE', `${etiqueta} id=${imputacion.id} sólo tiene ${saldo} de saldo disponible.`);
  }
  const nuevoSaldo = Math.max(0, redondearMoneda(saldo - imputacion.monto_imputado));
  const nuevoEstado = nuevoSaldo <= EPSILON_MONTO ? estadoTerminal : 'PARCIAL';

  await client.query(`UPDATE ${tabla} SET ${columnaSaldo} = $1, estado = $2 WHERE ${columnaId} = $3`, [
    nuevoSaldo,
    nuevoEstado,
    imputacion.id,
  ]);

  return Number(documento.cotizacion);
}

interface RetencionCalculada extends RetencionOPInput {
  monto_retenido: number;
}

interface DatosAsientoCancelacion {
  id_orden_pago: number;
  nro_op: string | null;
  id_usuario: number;
  totalFacturasArs: number;
  totalNotasCreditoArs: number;
  totalAnticiposArs: number;
  cotizacionPago: number;
  retenciones: RetencionCalculada[];
  mediosPago: MedioPagoOPInput[];
}

/**
 * Asiento de Cancelación: Debe Proveedores (neto de NC ya reversadas en su
 * propio asiento de alta), Haber Anticipos a Proveedores / Retenciones /
 * Caja-Banco, y una línea de Diferencia de Cambio que **balancea** el
 * asiento por construcción (Debe − el resto de los Haberes) — no depende
 * del trigger diferido para "salvarse", pero el trigger igual corre como
 * red de seguridad.
 */
async function crearAsientoCancelacion(client: PoolClient, datos: DatosAsientoCancelacion): Promise<void> {
  const { rows: asientoRows } = await client.query<{ id_asiento: number }>(
    `INSERT INTO asientos_contables (concepto, id_orden_pago, id_usuario) VALUES ($1, $2, $3) RETURNING id_asiento`,
    [`Cancelación - Orden de Pago ${datos.nro_op ?? datos.id_orden_pago}`, datos.id_orden_pago, datos.id_usuario],
  );
  const idAsiento = asientoRows[0].id_asiento;

  async function insertarDebe(codigo: string, monto: number): Promise<void> {
    if (monto <= 0.005) return;
    const idCuenta = await obtenerIdCuentaPorCodigo(client, codigo);
    await client.query(`INSERT INTO asientos_detalle (id_asiento, id_cuenta_contable, debe, haber) VALUES ($1, $2, $3, 0)`, [
      idAsiento,
      idCuenta,
      redondearMoneda(monto),
    ]);
  }
  async function insertarHaber(codigo: string, monto: number): Promise<void> {
    if (monto <= 0.005) return;
    const idCuenta = await obtenerIdCuentaPorCodigo(client, codigo);
    await client.query(`INSERT INTO asientos_detalle (id_asiento, id_cuenta_contable, debe, haber) VALUES ($1, $2, 0, $3)`, [
      idAsiento,
      idCuenta,
      redondearMoneda(monto),
    ]);
  }

  const debeProveedores = redondearMoneda(datos.totalFacturasArs - datos.totalNotasCreditoArs);
  await insertarDebe(CUENTA_PROVEEDORES, debeProveedores);
  await insertarHaber(CUENTA_ANTICIPOS_PROVEEDORES, datos.totalAnticiposArs);

  let totalRetencionesArs = 0;
  for (const retencion of datos.retenciones) {
    const montoArs = redondearMoneda(retencion.monto_retenido * datos.cotizacionPago);
    totalRetencionesArs = redondearMoneda(totalRetencionesArs + montoArs);
    await insertarHaber(CUENTAS_RETENCION[retencion.tipo_retencion], montoArs);
  }

  const totalCajaArs = redondearMoneda(
    datos.mediosPago.filter((m) => m.tipo === 'EFECTIVO').reduce((acc, m) => acc + m.monto, 0) * datos.cotizacionPago,
  );
  const totalBancoArs = redondearMoneda(
    datos.mediosPago.filter((m) => m.tipo !== 'EFECTIVO').reduce((acc, m) => acc + m.monto, 0) * datos.cotizacionPago,
  );
  await insertarHaber(CUENTA_CAJA, totalCajaArs);
  await insertarHaber(CUENTA_BANCO, totalBancoArs);

  // Si lo que se acredita (anticipos + retenciones + caja/banco, a cotización
  // ACTUAL) supera lo que estaba debitado a Proveedores (a cotización
  // HISTÓRICA de cada documento), se pagó más pesos de los que se debían
  // registrar en su momento: eso es una PÉRDIDA (Debe). Si es al revés, GANANCIA (Haber).
  const diferencia = redondearMoneda(
    datos.totalAnticiposArs + totalRetencionesArs + totalCajaArs + totalBancoArs - debeProveedores,
  );
  if (diferencia > 0.005) {
    await insertarDebe(CUENTA_DIFERENCIA_CAMBIO_PERDIDA, diferencia);
  } else if (diferencia < -0.005) {
    await insertarHaber(CUENTA_DIFERENCIA_CAMBIO_GANANCIA, -diferencia);
  }
}

/**
 * Emite una Orden de Pago: imputa contra facturas/NC/anticipos existentes
 * del proveedor, calcula retenciones y diferencia de cambio, y genera el
 * asiento de Cancelación — todo en una única transacción. Alcance de este
 * incremento: sólo paga documentos ya cargados (no crea anticipos nuevos,
 * ver nota en `types/domain.ts`).
 */
export async function emitirOrdenPago(
  input: EmitirOrdenPagoInput,
  contexto: { id_sucursal: number; id_usuario: number },
): Promise<EmitirOrdenPagoResult> {
  validarPayload(input);
  const moneda = input.moneda ?? 'ARS';
  const fecha = input.fecha ?? hoyISO();
  const cotizacionPago = moneda === 'USD' ? Number((await obtenerCotizacion('USD', fecha)).valor) : 1;

  return withTransaction(async (client) => {
    const { rows: proveedorRows } = await client.query<{ id_proveedor: number }>(
      `SELECT id_proveedor FROM proveedores WHERE id_proveedor = $1`,
      [input.id_proveedor],
    );
    if (!proveedorRows[0]) {
      throw AppError.notFound('PROVEEDOR_NO_ENCONTRADO', `No existe el proveedor id_proveedor=${input.id_proveedor}`);
    }

    let totalFacturas = 0;
    let totalNotasCredito = 0;
    let totalAnticipos = 0;
    let totalFacturasArs = 0;
    let totalNotasCreditoArs = 0;
    let totalAnticiposArs = 0;

    for (const imputacion of input.imputaciones) {
      const cotizacionDocumento = await procesarImputacion(client, imputacion, input.id_proveedor, moneda);
      const montoArs = redondearMoneda(imputacion.monto_imputado * cotizacionDocumento);

      if (imputacion.tipo === 'FACTURA') {
        totalFacturas = redondearMoneda(totalFacturas + imputacion.monto_imputado);
        totalFacturasArs = redondearMoneda(totalFacturasArs + montoArs);
      } else if (imputacion.tipo === 'NOTA_CREDITO') {
        totalNotasCredito = redondearMoneda(totalNotasCredito + imputacion.monto_imputado);
        totalNotasCreditoArs = redondearMoneda(totalNotasCreditoArs + montoArs);
      } else {
        totalAnticipos = redondearMoneda(totalAnticipos + imputacion.monto_imputado);
        totalAnticiposArs = redondearMoneda(totalAnticiposArs + montoArs);
      }
    }

    const retenciones: RetencionCalculada[] = (input.retenciones ?? []).map((r) => ({
      ...r,
      monto_retenido: redondearMoneda(r.base_imponible * r.alicuota),
    }));
    const totalRetenciones = redondearMoneda(retenciones.reduce((acc, r) => acc + r.monto_retenido, 0));

    const netoAPagar = redondearMoneda(totalFacturas - totalNotasCredito - totalAnticipos - totalRetenciones);
    if (netoAPagar < 0) {
      throw AppError.badRequest(
        'NETO_NEGATIVO',
        'Las notas de crédito, anticipos y retenciones imputados superan el total de facturas.',
      );
    }

    const totalMediosPago = redondearMoneda(input.medios_pago.reduce((acc, m) => acc + m.monto, 0));
    if (Math.abs(totalMediosPago - netoAPagar) > EPSILON_MONTO) {
      throw AppError.badRequest(
        'MEDIOS_PAGO_NO_COINCIDEN',
        `Los medios de pago (${totalMediosPago}) no coinciden con el neto a pagar (${netoAPagar}).`,
      );
    }

    const { rows: opRows } = await client.query<OrdenPago>(
      `INSERT INTO ordenes_pago
         (id_proveedor, id_sucursal, fecha, moneda, total_facturas, total_notas_credito, total_anticipos,
          total_retenciones, neto_a_pagar, diferencia_cambio, id_usuario_emitio)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10)
       RETURNING ${COLUMNAS_OP}`,
      [
        input.id_proveedor,
        contexto.id_sucursal,
        fecha,
        moneda,
        totalFacturas,
        totalNotasCredito,
        totalAnticipos,
        totalRetenciones,
        netoAPagar,
        contexto.id_usuario,
      ],
    );
    let ordenPago = opRows[0];

    const imputacionesGuardadas: OpImputacion[] = [];
    for (const imputacion of input.imputaciones) {
      const columnaId =
        imputacion.tipo === 'FACTURA'
          ? 'id_factura_proveedor'
          : imputacion.tipo === 'NOTA_CREDITO'
            ? 'id_nota_credito_proveedor'
            : 'id_anticipo_proveedor';
      const { rows } = await client.query<OpImputacion>(
        `INSERT INTO op_imputaciones (id_orden_pago, ${columnaId}, monto_imputado)
         VALUES ($1, $2, $3)
         RETURNING id_op_imputacion, id_orden_pago, id_factura_proveedor, id_nota_credito_proveedor, id_anticipo_proveedor, monto_imputado`,
        [ordenPago.id_orden_pago, imputacion.id, imputacion.monto_imputado],
      );
      imputacionesGuardadas.push(rows[0]);
    }

    const mediosPagoGuardados: OpMedioPago[] = [];
    for (const medio of input.medios_pago) {
      const { rows } = await client.query<OpMedioPago>(
        `INSERT INTO op_medios_pago (id_orden_pago, tipo, monto, nro_cheque, banco_emisor, fecha_pago_cheque, cbu_destino, nro_operacion)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id_op_medio_pago, id_orden_pago, tipo, monto, nro_cheque, banco_emisor, fecha_pago_cheque, cbu_destino, nro_operacion`,
        [
          ordenPago.id_orden_pago,
          medio.tipo,
          medio.monto,
          medio.nro_cheque?.trim() || null,
          medio.banco_emisor?.trim() || null,
          medio.fecha_pago_cheque ?? null,
          medio.cbu_destino?.trim() || null,
          medio.nro_operacion?.trim() || null,
        ],
      );
      mediosPagoGuardados.push(rows[0]);
    }

    const retencionesGuardadas: OpRetencion[] = [];
    for (const retencion of retenciones) {
      const idCuenta = await obtenerIdCuentaPorCodigo(client, CUENTAS_RETENCION[retencion.tipo_retencion]);
      const { rows } = await client.query<OpRetencion>(
        `INSERT INTO op_retenciones (id_orden_pago, tipo_retencion, base_imponible, alicuota, monto_retenido, id_cuenta_contable)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id_op_retencion, id_orden_pago, tipo_retencion, base_imponible, alicuota, monto_retenido, nro_certificado, id_cuenta_contable`,
        [ordenPago.id_orden_pago, retencion.tipo_retencion, retencion.base_imponible, retencion.alicuota, retencion.monto_retenido, idCuenta],
      );
      retencionesGuardadas.push(rows[0]);
    }

    await crearAsientoCancelacion(client, {
      id_orden_pago: ordenPago.id_orden_pago,
      nro_op: ordenPago.nro_op,
      id_usuario: contexto.id_usuario,
      totalFacturasArs,
      totalNotasCreditoArs,
      totalAnticiposArs,
      cotizacionPago,
      retenciones,
      mediosPago: input.medios_pago,
    });

    const debeProveedores = redondearMoneda(totalFacturasArs - totalNotasCreditoArs);
    const totalRetencionesArs = redondearMoneda(retenciones.reduce((acc, r) => acc + r.monto_retenido, 0) * cotizacionPago);
    const totalMediosPagoArs = redondearMoneda(totalMediosPago * cotizacionPago);
    // Mismo signo que `crearAsientoCancelacion`: positivo = pérdida (se pagó
    // más pesos que lo debitado a Proveedores a la cotización histórica).
    const diferenciaCambio = redondearMoneda(totalAnticiposArs + totalRetencionesArs + totalMediosPagoArs - debeProveedores);

    const { rows: opActualizadaRows } = await client.query<OrdenPago>(
      `UPDATE ordenes_pago SET diferencia_cambio = $1 WHERE id_orden_pago = $2 RETURNING ${COLUMNAS_OP}`,
      [diferenciaCambio, ordenPago.id_orden_pago],
    );
    ordenPago = opActualizadaRows[0];

    return {
      orden_pago: ordenPago,
      imputaciones: imputacionesGuardadas,
      retenciones: retencionesGuardadas,
      medios_pago: mediosPagoGuardados,
    };
  });
}

export async function buscarOrdenPagoPorId(id_orden_pago: number): Promise<OrdenPago> {
  const { rows } = await pool.query<OrdenPago>(`SELECT ${COLUMNAS_OP} FROM ordenes_pago WHERE id_orden_pago = $1`, [
    id_orden_pago,
  ]);
  const ordenPago = rows[0];
  if (!ordenPago) {
    throw AppError.notFound('ORDEN_PAGO_NO_ENCONTRADA', `No existe la orden de pago id_orden_pago=${id_orden_pago}`);
  }
  return ordenPago;
}

export async function buscarOrdenesPago(id_proveedor?: number): Promise<OrdenPago[]> {
  if (id_proveedor !== undefined) {
    const { rows } = await pool.query<OrdenPago>(
      `SELECT ${COLUMNAS_OP} FROM ordenes_pago WHERE id_proveedor = $1 ORDER BY fecha DESC LIMIT 50`,
      [id_proveedor],
    );
    return rows;
  }
  const { rows } = await pool.query<OrdenPago>(`SELECT ${COLUMNAS_OP} FROM ordenes_pago ORDER BY fecha DESC LIMIT 50`);
  return rows;
}

/**
 * Anula una Orden de Pago: revierte el saldo/estado de cada documento
 * imputado y genera un asiento de reversión (nunca se borra el asiento
 * original — "el sistema como auditor").
 */
export async function anularOrdenPago(
  id_orden_pago: number,
  contexto: { id_usuario: number },
  input: AnularOrdenPagoInput,
): Promise<OrdenPago> {
  if (!input.motivo || !input.motivo.trim()) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'motivo es requerido para anular una Orden de Pago.');
  }

  return withTransaction(async (client) => {
    const { rows: opRows } = await client.query<OrdenPago>(
      `SELECT ${COLUMNAS_OP} FROM ordenes_pago WHERE id_orden_pago = $1 FOR UPDATE`,
      [id_orden_pago],
    );
    const ordenPago = opRows[0];
    if (!ordenPago) {
      throw AppError.notFound('ORDEN_PAGO_NO_ENCONTRADA', `No existe la orden de pago id_orden_pago=${id_orden_pago}`);
    }
    if (ordenPago.estado === 'ANULADA') {
      throw AppError.badRequest('ORDEN_PAGO_YA_ANULADA', 'La Orden de Pago ya está anulada.');
    }

    const { rows: imputaciones } = await client.query<OpImputacion>(
      `SELECT id_op_imputacion, id_orden_pago, id_factura_proveedor, id_nota_credito_proveedor, id_anticipo_proveedor, monto_imputado
       FROM op_imputaciones WHERE id_orden_pago = $1`,
      [id_orden_pago],
    );

    for (const imputacion of imputaciones) {
      if (imputacion.id_factura_proveedor) {
        await revertirImputacion(client, 'facturas_proveedor', 'id_factura_proveedor', 'saldo_pendiente', 'PENDIENTE', imputacion.id_factura_proveedor, Number(imputacion.monto_imputado));
      } else if (imputacion.id_nota_credito_proveedor) {
        await revertirImputacion(client, 'notas_credito_proveedor', 'id_nota_credito_proveedor', 'saldo_disponible', 'DISPONIBLE', imputacion.id_nota_credito_proveedor, Number(imputacion.monto_imputado));
      } else if (imputacion.id_anticipo_proveedor) {
        await revertirImputacion(client, 'anticipos_proveedor', 'id_anticipo_proveedor', 'saldo_disponible', 'DISPONIBLE', imputacion.id_anticipo_proveedor, Number(imputacion.monto_imputado));
      }
    }

    const { rows: asientoOriginalRows } = await client.query<{ id_asiento: number }>(
      `SELECT id_asiento FROM asientos_contables WHERE id_orden_pago = $1 ORDER BY id_asiento DESC LIMIT 1`,
      [id_orden_pago],
    );
    const idAsientoOriginal = asientoOriginalRows[0]?.id_asiento;
    if (idAsientoOriginal) {
      const { rows: detalleOriginal } = await client.query<{ id_cuenta_contable: number; debe: string; haber: string }>(
        `SELECT id_cuenta_contable, debe, haber FROM asientos_detalle WHERE id_asiento = $1`,
        [idAsientoOriginal],
      );
      const { rows: nuevoAsientoRows } = await client.query<{ id_asiento: number }>(
        `INSERT INTO asientos_contables (concepto, id_orden_pago, id_usuario) VALUES ($1, $2, $3) RETURNING id_asiento`,
        [`Reversión - Anulación Orden de Pago ${ordenPago.nro_op ?? id_orden_pago}`, id_orden_pago, contexto.id_usuario],
      );
      const idAsientoReversion = nuevoAsientoRows[0].id_asiento;
      for (const linea of detalleOriginal) {
        await client.query(
          `INSERT INTO asientos_detalle (id_asiento, id_cuenta_contable, debe, haber) VALUES ($1, $2, $3, $4)`,
          [idAsientoReversion, linea.id_cuenta_contable, linea.haber, linea.debe],
        );
      }
    }

    const { rows: actualizadaRows } = await client.query<OrdenPago>(
      `UPDATE ordenes_pago SET estado = 'ANULADA', motivo_anulacion = $1, id_usuario_anulo = $2, fecha_anulacion = NOW()
       WHERE id_orden_pago = $3 RETURNING ${COLUMNAS_OP}`,
      [input.motivo, contexto.id_usuario, id_orden_pago],
    );
    return actualizadaRows[0];
  });
}

async function revertirImputacion(
  client: PoolClient,
  tabla: string,
  columnaId: string,
  columnaSaldo: string,
  estadoInicial: string,
  id: number,
  monto: number,
): Promise<void> {
  const { rows } = await client.query<{ saldo: string; importe_total: string }>(
    `SELECT ${columnaSaldo} AS saldo, importe_total FROM ${tabla} WHERE ${columnaId} = $1 FOR UPDATE`,
    [id],
  );
  const fila = rows[0];
  if (!fila) return;
  const nuevoSaldo = redondearMoneda(Math.min(Number(fila.importe_total), Number(fila.saldo) + monto));
  const nuevoEstado = nuevoSaldo >= Number(fila.importe_total) - EPSILON_MONTO ? estadoInicial : 'PARCIAL';
  await client.query(`UPDATE ${tabla} SET ${columnaSaldo} = $1, estado = $2 WHERE ${columnaId} = $3`, [nuevoSaldo, nuevoEstado, id]);
}
