import type { Pool, PoolClient } from 'pg';
import { pool, withTransaction } from '../config/db';
import { AppError } from '../utils/AppError';
import { verificarAccesoSucursal } from '../utils/autorizacion.utils';
import { DOCUMENTO_COLUMNAS_BASE, ETIQUETA_TIPO_DOCUMENTO, redondearMoneda, resolverCantidadUnidades } from '../utils/documento.utils';
import { tipoDocumentoVentaPorCliente } from '../utils/identificacion.utils';
import { buscarClientePorId } from './clientes.service';
import { crearComprobanteAfip } from './emision/comprobantesAfip.repository';
import { crearComprobanteInterno } from './emision/comprobantesInternos.repository';
import { liberarReserva, registrarReserva } from './reservas.service';
import { despacharDocumento, type ContextoRemito, type DespachoItem } from './remitos.service';
import {
  calcularItems,
  insertarDetalles,
  obtenerCuentasEmpresa,
  obtenerProductos,
  type ContextoFacturacion,
} from './ventas.service';
import type {
  AnularOrdenEntregaInput,
  Documento,
  EditarTipoEntregaOrdenInput,
  ItemVentaMixtaInput,
  OrdenEntrega,
  OrdenEntregaDetalle,
  ProcesarVentaMixtaInput,
  ProcesarVentaMixtaResult,
  Producto,
} from '../types/domain';

type Queryable = Pool | PoolClient;

export const ORDEN_ENTREGA_COLUMNAS = `id_orden_entrega, nro_orden, id_documento, id_sucursal_origen, cliente_id, estado,
  tipo_entrega, direccion_envio, fecha_pactada_envio,
  fecha_creacion, id_usuario_creo, id_sucursal_retiro, id_usuario_retiro, fecha_retiro, id_remito_retiro,
  motivo_anulacion, id_usuario_anulo, fecha_anulacion`;

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Lockea una orden por ID (no por `nro_orden`) — la usa `hojasDeRuta.service.ts`, que ya tiene el ID guardado en `hoja_de_ruta_ordenes`. */
export async function bloquearOrdenEntregaPorId(client: PoolClient, id_orden_entrega: number): Promise<OrdenEntrega | null> {
  const { rows } = await client.query<OrdenEntrega>(
    `SELECT ${ORDEN_ENTREGA_COLUMNAS} FROM ordenes_entrega WHERE id_orden_entrega = $1 FOR UPDATE`,
    [id_orden_entrega],
  );
  return rows[0] ?? null;
}

export async function obtenerDetallesOrdenEntrega(client: Queryable, id_orden_entrega: number): Promise<OrdenEntregaDetalle[]> {
  const { rows } = await client.query<OrdenEntregaDetalle>(
    `SELECT oed.id_orden_entrega_detalle, oed.id_orden_entrega, oed.id_producto, p.sku, p.descripcion, oed.cantidad
     FROM ordenes_entrega_detalles oed
     JOIN productos p ON p.id_producto = oed.id_producto
     WHERE oed.id_orden_entrega = $1
     ORDER BY oed.id_orden_entrega_detalle`,
    [id_orden_entrega],
  );
  return rows;
}

/** `cantidad_retiro_inmediato` viaja en la misma unidad de carga (`unidad_ingreso`) que `cantidad`; se resuelve con el mismo criterio KG->unidades que ya usa `calcularItems`. */
function resolverRetiroInmediato(input: ItemVentaMixtaInput, producto: Producto): number {
  const retiro = input.cantidad_retiro_inmediato ?? 0;
  if (retiro <= 0) return 0;
  return resolverCantidadUnidades(retiro, input.unidad_ingreso ?? 'U', Number(producto.peso_teorico_kg), producto.sku);
}

function redondearCantidad(valor: number): number {
  return Math.round(valor * 1000) / 1000;
}

function validarPayloadVentaMixta(input: ProcesarVentaMixtaInput): void {
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
    const retiroInmediato = item.cantidad_retiro_inmediato ?? 0;
    if (retiroInmediato < 0 || retiroInmediato > item.cantidad) {
      throw AppError.badRequest(
        'PAYLOAD_INVALIDO',
        `Ítem id_producto=${item.id_producto}: cantidad_retiro_inmediato no puede ser negativa ni superar la cantidad vendida.`,
      );
    }
  }
  for (const pago of input.pagos) {
    if (!Number.isInteger(pago.id_cuenta) || pago.monto <= 0) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'Cada pago requiere id_cuenta válido y monto positivo.');
    }
  }

  // La existencia (o no) de un remanente pendiente ya se determina con los
  // valores crudos del payload — la resolución KG->unidades es proporcional,
  // nunca cambia si un ítem queda con saldo pendiente o no.
  const quedaAlgoPendiente = input.items.some((item) => (item.cantidad_retiro_inmediato ?? 0) < item.cantidad);
  if (quedaAlgoPendiente) {
    if (input.tipo_entrega !== 'RETIRO_CLIENTE' && input.tipo_entrega !== 'ENVIO_DOMICILIO') {
      throw AppError.badRequest(
        'PAYLOAD_INVALIDO',
        'tipo_entrega es requerido (RETIRO_CLIENTE o ENVIO_DOMICILIO) cuando algún ítem queda con cantidad pendiente.',
      );
    }
    if (input.tipo_entrega === 'ENVIO_DOMICILIO') {
      if (!input.direccion_envio?.trim()) {
        throw AppError.badRequest('PAYLOAD_INVALIDO', 'direccion_envio es requerida para un envío a domicilio.');
      }
      if (!FECHA_REGEX.test(input.fecha_pactada_envio ?? '')) {
        throw AppError.badRequest('PAYLOAD_INVALIDO', 'fecha_pactada_envio es requerida con formato YYYY-MM-DD.');
      }
    }
  }
}

/**
 * Venta mixta: una misma Factura puede dividir cada renglón entre retiro
 * inmediato (despacha ya mismo, sin reserva) y cantidad pendiente (reserva
 * `stock_disponible` en la sucursal donde se vende y genera una Orden de
 * Entrega, retirable después desde cualquier sucursal — ver
 * `retirarOrdenEntrega`). Todo en una única transacción: cabecera +
 * detalles + cuenta_corriente (el límite de crédito lo sigue validando el
 * trigger de Postgres, igual que en `ventas.service.ts::facturarVenta`) +
 * despacho inmediato + reserva/Orden de Entrega.
 *
 * Simplificación de este incremento: a diferencia de `facturarVenta`, NO
 * dispara la solicitud de CAE a AFIP (el documento queda con
 * `estado_afip='PENDIENTE'` para una venta fiscal) — la integración AFIP de
 * este flujo queda para un paso siguiente, fuera del alcance pedido (que es
 * el modelo de stock/reservas).
 */
export async function procesarVentaMixta(
  contexto: ContextoFacturacion,
  input: ProcesarVentaMixtaInput,
): Promise<ProcesarVentaMixtaResult> {
  validarPayloadVentaMixta(input);

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
    const cuentasEmpresa = await obtenerCuentasEmpresa(
      input.pagos.map((p) => p.id_cuenta),
      client,
    );

    // NO dispara la solicitud de CAE a AFIP (ver comentario de la función):
    // sólo deja constancia en la satélite que corresponda, agnóstica del
    // stock/reservas que se procesan más abajo.
    const esFiscal = input.es_fiscal !== false;

    const { rows: documentoRows } = await client.query<Documento>(
      `INSERT INTO documentos (id_sucursal_origen, fecha, cliente_id, total_neto, tipo_documento, id_zona, es_fiscal)
       VALUES ($1, NOW(), $2, $3, $4, $5, $6)
       RETURNING ${DOCUMENTO_COLUMNAS_BASE}`,
      [contexto.id_sucursal, input.cliente_id, totalNeto, tipo_documento, cliente.id_zona, esFiscal],
    );
    let documento: Documento = { ...documentoRows[0], items };
    if (esFiscal) {
      const comprobante = await crearComprobanteAfip(client, {
        id_documento: documento.id_documento,
        tipo_comprobante: null,
        punto_venta: null,
        estado_afip: 'PENDIENTE',
      });
      documento = { ...documento, ...comprobante, estado_facturacion_interna: null };
    } else {
      const comprobante = await crearComprobanteInterno(client, { id_documento: documento.id_documento, nro_remito: documento.nro_remito });
      documento = {
        ...documento,
        tipo_comprobante: null,
        punto_venta: null,
        nro_comprobante_afip: null,
        cae: null,
        cae_vencimiento: null,
        estado_afip: null,
        error_afip_mensaje: null,
        estado_facturacion_interna: comprobante.estado_facturacion_interna,
      };
    }
    await insertarDetalles(client, documento.id_documento, items);

    await client.query(
      `INSERT INTO cuenta_corriente (cliente_id, fecha, debe, haber, id_documento, concepto)
       VALUES ($1, NOW(), $2, 0, $3, $4)`,
      [
        input.cliente_id,
        totalNeto,
        documento.id_documento,
        `Venta ${ETIQUETA_TIPO_DOCUMENTO[tipo_documento]} - Remito ${documento.nro_remito}`,
      ],
    );

    for (const pago of input.pagos) {
      const cuenta = cuentasEmpresa.get(pago.id_cuenta)!;
      await client.query(
        `INSERT INTO cuenta_corriente (cliente_id, fecha, debe, haber, id_documento, id_cuenta, concepto)
         VALUES ($1, NOW(), 0, $2, $3, $4, $5)`,
        [input.cliente_id, pago.monto, documento.id_documento, pago.id_cuenta, `Pago ${cuenta.nombre_cuenta} - Remito ${documento.nro_remito}`],
      );
    }

    const itemsInmediatos: DespachoItem[] = [];
    const itemsPendientes: DespachoItem[] = [];

    for (const inputItem of input.items) {
      const producto = productos.get(inputItem.id_producto)!;
      const itemResuelto = items.find((i) => i.id_producto === inputItem.id_producto)!;
      const retiroInmediato = resolverRetiroInmediato(inputItem, producto);
      if (retiroInmediato > 0) {
        itemsInmediatos.push({ id_producto: inputItem.id_producto, cantidad: retiroInmediato });
      }
      const pendiente = redondearCantidad(itemResuelto.cantidad - retiroInmediato);
      if (pendiente > 0) {
        itemsPendientes.push({ id_producto: inputItem.id_producto, cantidad: pendiente });
      }
    }

    let remitoInmediato: ProcesarVentaMixtaResult['remito_inmediato'] = null;
    if (itemsInmediatos.length > 0) {
      remitoInmediato = await despacharDocumento(client, {
        id_documento: documento.id_documento,
        cliente_id: documento.cliente_id,
        es_fiscal: documento.es_fiscal,
        id_sucursal_despacho: contexto.id_sucursal,
        items: itemsInmediatos,
        estado_inicial: 'ENTREGADO',
        tipo_movimiento_stock: 'VENTA_DIRECTA',
        comprobante_ref: `DOCUMENTO:${documento.id_documento}`,
        id_usuario: contexto.id_usuario,
      });
    }

    let ordenEntrega: OrdenEntrega | null = null;
    if (itemsPendientes.length > 0) {
      for (const item of itemsPendientes) {
        const { rows: stockRows } = await client.query<{ cantidad: string; cantidad_reservada: string }>(
          `SELECT cantidad, cantidad_reservada FROM stock_sucursal WHERE id_producto = $1 AND id_sucursal = $2 FOR UPDATE`,
          [item.id_producto, contexto.id_sucursal],
        );
        const fila = stockRows[0];
        const disponible = fila ? Number(fila.cantidad) - Number(fila.cantidad_reservada) : 0;
        if (item.cantidad > disponible) {
          throw AppError.conflict(
            'STOCK_INSUFICIENTE',
            `El producto id_producto=${item.id_producto} sólo tiene ${disponible} unidades disponibles para reservar.`,
          );
        }
        // Reserva atada al documento (ledger): mantiene el invariante
        // cantidad_reservada == SUM(reservas_stock) por (producto, sucursal).
        await registrarReserva(client, {
          id_documento: documento.id_documento,
          id_producto: item.id_producto,
          id_sucursal: contexto.id_sucursal,
          cantidad: item.cantidad,
          comprobante_ref: `DOCUMENTO:${documento.id_documento}`,
          id_usuario: contexto.id_usuario,
        });
      }

      const esEnvio = input.tipo_entrega === 'ENVIO_DOMICILIO';
      const { rows: ordenRows } = await client.query<OrdenEntrega>(
        `INSERT INTO ordenes_entrega (id_documento, id_sucursal_origen, cliente_id, id_usuario_creo, tipo_entrega, direccion_envio, fecha_pactada_envio)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${ORDEN_ENTREGA_COLUMNAS}`,
        [
          documento.id_documento,
          contexto.id_sucursal,
          input.cliente_id,
          contexto.id_usuario,
          input.tipo_entrega,
          esEnvio ? input.direccion_envio!.trim() : null,
          esEnvio ? input.fecha_pactada_envio : null,
        ],
      );
      const orden = ordenRows[0];

      const detalles: OrdenEntregaDetalle[] = [];
      for (const item of itemsPendientes) {
        const producto = productos.get(item.id_producto)!;
        const { rows: detalleRows } = await client.query<{ id_orden_entrega_detalle: number }>(
          `INSERT INTO ordenes_entrega_detalles (id_orden_entrega, id_producto, cantidad)
           VALUES ($1, $2, $3) RETURNING id_orden_entrega_detalle`,
          [orden.id_orden_entrega, item.id_producto, item.cantidad],
        );
        detalles.push({
          id_orden_entrega_detalle: detalleRows[0].id_orden_entrega_detalle,
          id_orden_entrega: orden.id_orden_entrega,
          id_producto: item.id_producto,
          sku: producto.sku,
          descripcion: producto.descripcion,
          cantidad: item.cantidad,
        });
      }
      orden.detalles = detalles;
      ordenEntrega = orden;
    }

    return { documento, remito_inmediato: remitoInmediato, orden_entrega: ordenEntrega };
  });
}

export async function buscarOrdenEntregaPorNro(nro_orden: string): Promise<OrdenEntrega> {
  const { rows } = await pool.query<OrdenEntrega>(`SELECT ${ORDEN_ENTREGA_COLUMNAS} FROM ordenes_entrega WHERE nro_orden = $1`, [
    nro_orden,
  ]);
  const orden = rows[0];
  if (!orden) {
    throw AppError.notFound('ORDEN_ENTREGA_NO_ENCONTRADA', `No existe la orden de entrega ${nro_orden}`);
  }
  orden.detalles = await obtenerDetallesOrdenEntrega(pool, orden.id_orden_entrega);
  return orden;
}

export interface CumplirOrdenEntregaParams {
  orden: OrdenEntrega;
  documento: { id_documento: number; cliente_id: number; es_fiscal: boolean };
  detalles: OrdenEntregaDetalle[];
  idSucursalDespacho: number;
  idUsuario: number;
  idCamion?: number | null;
  idChofer?: string | null;
}

/**
 * Núcleo compartido de "cumplir una Orden de Entrega Pendiente": libera la
 * reserva en la sucursal de origen y despacha físicamente desde
 * `idSucursalDespacho` (que puede ser otra), lockeando ambas filas de
 * `stock_sucursal` de menor a mayor `id_sucursal` para evitar deadlocks
 * entre dos cumplimientos cruzados concurrentes en sentido opuesto.
 *
 * Reutilizado por `retirarOrdenEntrega` (retiro en mostrador,
 * `idSucursalDespacho = contexto.id_sucursal` del operador) y por
 * `hojasDeRuta.service.ts::confirmarSalidaHojaDeRuta` (entrega por
 * logística, `idSucursalDespacho` elegido al armar el viaje, con
 * `idCamion`/`idChofer` de la Hoja de Ruta). El llamador es responsable de
 * haber lockeado `orden`/`documento` `FOR UPDATE` y validado que
 * `orden.estado === 'PENDIENTE'` antes de invocar esto.
 */
export async function cumplirOrdenEntrega(client: PoolClient, params: CumplirOrdenEntregaParams): Promise<OrdenEntrega> {
  const { orden, documento, detalles, idSucursalDespacho, idUsuario, idCamion, idChofer } = params;
  const idSucursalOrigen = orden.id_sucursal_origen;

  for (const detalle of detalles) {
    const cantidad = Number(detalle.cantidad);
    const sucursalesALockear =
      idSucursalOrigen === idSucursalDespacho
        ? [idSucursalOrigen]
        : [Math.min(idSucursalOrigen, idSucursalDespacho), Math.max(idSucursalOrigen, idSucursalDespacho)];
    for (const idSucursal of sucursalesALockear) {
      await client.query(`SELECT cantidad FROM stock_sucursal WHERE id_producto = $1 AND id_sucursal = $2 FOR UPDATE`, [
        detalle.id_producto,
        idSucursal,
      ]);
    }
    await liberarReserva(client, {
      id_documento: orden.id_documento,
      id_producto: detalle.id_producto,
      id_sucursal: idSucursalOrigen,
      cantidad,
      comprobante_ref: `ORDEN_ENTREGA:${orden.nro_orden}`,
      id_usuario: idUsuario,
      tipo_movimiento: 'RESERVA_LIBERADA',
    });
  }

  const remito = await despacharDocumento(client, {
    id_documento: orden.id_documento,
    cliente_id: documento.cliente_id,
    es_fiscal: documento.es_fiscal,
    id_sucursal_despacho: idSucursalDespacho,
    items: detalles.map((d) => ({ id_producto: d.id_producto, cantidad: Number(d.cantidad) })),
    id_camion: idCamion,
    id_chofer: idChofer,
    estado_inicial: 'ENTREGADO',
    tipo_movimiento_stock: idSucursalOrigen === idSucursalDespacho ? 'DESPACHO_LOCAL' : 'DESPACHO_CRUZADO',
    comprobante_ref: `ORDEN_ENTREGA:${orden.nro_orden}`,
    id_usuario: idUsuario,
  });

  const { rows: actualizadaRows } = await client.query<OrdenEntrega>(
    `UPDATE ordenes_entrega SET estado = 'RETIRADA', id_sucursal_retiro = $1, id_usuario_retiro = $2, fecha_retiro = NOW(), id_remito_retiro = $3
     WHERE id_orden_entrega = $4
     RETURNING ${ORDEN_ENTREGA_COLUMNAS}`,
    [idSucursalDespacho, idUsuario, remito.id_remito, orden.id_orden_entrega],
  );
  const actualizada = actualizadaRows[0];
  actualizada.detalles = detalles;
  return actualizada;
}

/**
 * Retiro de una Orden de Entrega Pendiente en mostrador: todo-o-nada por
 * renglón (no hay retiro parcial). Puede ejecutarse desde CUALQUIER
 * sucursal, no necesariamente la de origen — por eso no valida
 * `verificarAccesoSucursal` contra `id_sucursal_origen`: la sucursal
 * relevante para esta acción es la del propio operador que retira
 * (`contexto.id_sucursal`, del JWT), no la de origen.
 */
export async function retirarOrdenEntrega(nro_orden: string, contexto: ContextoFacturacion): Promise<OrdenEntrega> {
  return withTransaction(async (client) => {
    const { rows: ordenRows } = await client.query<OrdenEntrega>(
      `SELECT ${ORDEN_ENTREGA_COLUMNAS} FROM ordenes_entrega WHERE nro_orden = $1 FOR UPDATE`,
      [nro_orden],
    );
    const orden = ordenRows[0];
    if (!orden) {
      throw AppError.notFound('ORDEN_ENTREGA_NO_ENCONTRADA', `No existe la orden de entrega ${nro_orden}`);
    }
    if (orden.estado === 'RETIRADA') {
      throw AppError.badRequest('ORDEN_YA_RETIRADA', 'Esta orden de entrega ya fue retirada.');
    }
    if (orden.estado === 'ANULADA') {
      throw AppError.badRequest('ORDEN_ANULADA', 'Esta orden de entrega fue anulada.');
    }

    const { rows: documentoRows } = await client.query<{ id_documento: number; cliente_id: number; es_fiscal: boolean }>(
      `SELECT id_documento, cliente_id, es_fiscal FROM documentos WHERE id_documento = $1 FOR UPDATE`,
      [orden.id_documento],
    );
    const documento = documentoRows[0];
    const detalles = await obtenerDetallesOrdenEntrega(client, orden.id_orden_entrega);

    return cumplirOrdenEntrega(client, {
      orden,
      documento,
      detalles,
      idSucursalDespacho: contexto.id_sucursal,
      idUsuario: contexto.id_usuario,
    });
  });
}

/**
 * Anula una Orden de Entrega Pendiente sin despacho físico: libera la
 * reserva en la sucursal de origen. Restringido a la sucursal de origen
 * para VENDEDOR (mismo criterio que `anularRemito`); ADMIN/SUPERVISOR sin
 * restricción.
 */
export async function anularOrdenEntrega(
  nro_orden: string,
  contexto: ContextoRemito,
  input: AnularOrdenEntregaInput,
): Promise<OrdenEntrega> {
  if (!input.motivo || !input.motivo.trim()) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'motivo es requerido para anular una orden de entrega.');
  }

  return withTransaction(async (client) => {
    const { rows: ordenRows } = await client.query<OrdenEntrega>(
      `SELECT ${ORDEN_ENTREGA_COLUMNAS} FROM ordenes_entrega WHERE nro_orden = $1 FOR UPDATE`,
      [nro_orden],
    );
    const orden = ordenRows[0];
    if (!orden) {
      throw AppError.notFound('ORDEN_ENTREGA_NO_ENCONTRADA', `No existe la orden de entrega ${nro_orden}`);
    }
    if (orden.estado === 'RETIRADA') {
      throw AppError.badRequest('ORDEN_YA_RETIRADA', 'Esta orden de entrega ya fue retirada; no se puede anular.');
    }
    if (orden.estado === 'ANULADA') {
      throw AppError.badRequest('ORDEN_YA_ANULADA', 'Esta orden de entrega ya está anulada.');
    }

    verificarAccesoSucursal(contexto, orden.id_sucursal_origen);

    const detalles = await obtenerDetallesOrdenEntrega(client, orden.id_orden_entrega);
    for (const detalle of detalles) {
      const cantidad = Number(detalle.cantidad);
      await liberarReserva(client, {
        id_documento: orden.id_documento,
        id_producto: detalle.id_producto,
        id_sucursal: orden.id_sucursal_origen,
        cantidad,
        comprobante_ref: `ORDEN_ENTREGA:${orden.nro_orden}`,
        id_usuario: contexto.id_usuario,
        tipo_movimiento: 'RESERVA_ANULADA',
      });
    }

    const { rows: actualizadaRows } = await client.query<OrdenEntrega>(
      `UPDATE ordenes_entrega SET estado = 'ANULADA', motivo_anulacion = $1, id_usuario_anulo = $2, fecha_anulacion = NOW()
       WHERE id_orden_entrega = $3
       RETURNING ${ORDEN_ENTREGA_COLUMNAS}`,
      [input.motivo, contexto.id_usuario, orden.id_orden_entrega],
    );
    const actualizada = actualizadaRows[0];
    actualizada.detalles = detalles;
    return actualizada;
  });
}

/**
 * Edita la intención de cumplimiento de una Orden de Entrega ya creada — el
 * caso "flete pagado aparte": el cliente compró para retirar en mostrador
 * y luego decide que se lo lleven; el cajero factura el flete y edita la
 * orden a `ENVIO_DOMICILIO` con su dirección y fecha. Al guardar, la orden
 * aparece automáticamente en el backlog de la Pizarra de Camiones — es la
 * misma consulta que ya filtra por `tipo_entrega`, no hace falta tocar
 * nada más. Restringido a la sucursal de origen para VENDEDOR (mismo
 * criterio que `anularOrdenEntrega`); ADMIN/SUPERVISOR sin restricción.
 *
 * Sólo aplica a órdenes `PENDIENTE`: una vez retirada o anulada, la
 * intención de cumplimiento ya no tiene sentido. Tampoco se puede editar
 * una orden que ya está cargada en un viaje activo (Hoja de Ruta no
 * anulada) — hay que sacarla del viaje primero (`quitarOrdenDeHoja`), para
 * no dejar un camión transportando algo que pasó a ser retiro en mostrador.
 */
export async function editarTipoEntregaOrden(
  nro_orden: string,
  input: EditarTipoEntregaOrdenInput,
  contexto: ContextoRemito,
): Promise<OrdenEntrega> {
  if (input.tipo_entrega !== 'RETIRO_CLIENTE' && input.tipo_entrega !== 'ENVIO_DOMICILIO') {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'tipo_entrega debe ser RETIRO_CLIENTE o ENVIO_DOMICILIO.');
  }
  const esEnvio = input.tipo_entrega === 'ENVIO_DOMICILIO';
  if (esEnvio) {
    if (!input.direccion_envio?.trim()) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'direccion_envio es requerida para un envío a domicilio.');
    }
    if (!FECHA_REGEX.test(input.fecha_pactada_envio ?? '')) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'fecha_pactada_envio es requerida con formato YYYY-MM-DD.');
    }
  }

  return withTransaction(async (client) => {
    const { rows: ordenRows } = await client.query<OrdenEntrega>(
      `SELECT ${ORDEN_ENTREGA_COLUMNAS} FROM ordenes_entrega WHERE nro_orden = $1 FOR UPDATE`,
      [nro_orden],
    );
    const orden = ordenRows[0];
    if (!orden) {
      throw AppError.notFound('ORDEN_ENTREGA_NO_ENCONTRADA', `No existe la orden de entrega ${nro_orden}`);
    }
    if (orden.estado !== 'PENDIENTE') {
      throw AppError.badRequest(
        'ORDEN_NO_EDITABLE',
        'Sólo se puede editar la intención de entrega de una orden pendiente.',
      );
    }

    verificarAccesoSucursal(contexto, orden.id_sucursal_origen);

    const { rows: enViajeRows } = await client.query<{ id_hoja_de_ruta: number }>(
      `SELECT hro.id_hoja_de_ruta FROM hoja_de_ruta_ordenes hro
       JOIN hojas_de_ruta hr ON hr.id_hoja_de_ruta = hro.id_hoja_de_ruta
       WHERE hro.id_orden_entrega = $1 AND hr.estado != 'ANULADA'`,
      [orden.id_orden_entrega],
    );
    if (enViajeRows[0]) {
      throw AppError.conflict(
        'ORDEN_ASIGNADA_A_HOJA',
        `La orden ${nro_orden} ya está cargada en una hoja de ruta; sacala del viaje antes de cambiar su intención de entrega.`,
      );
    }

    const { rows: actualizadaRows } = await client.query<OrdenEntrega>(
      `UPDATE ordenes_entrega SET tipo_entrega = $1, direccion_envio = $2, fecha_pactada_envio = $3
       WHERE id_orden_entrega = $4
       RETURNING ${ORDEN_ENTREGA_COLUMNAS}`,
      [input.tipo_entrega, esEnvio ? input.direccion_envio!.trim() : null, esEnvio ? input.fecha_pactada_envio : null, orden.id_orden_entrega],
    );
    const actualizada = actualizadaRows[0];
    actualizada.detalles = await obtenerDetallesOrdenEntrega(client, orden.id_orden_entrega);
    return actualizada;
  });
}
