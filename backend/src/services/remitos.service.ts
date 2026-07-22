import type { Pool, PoolClient } from 'pg';
import { pool, withTransaction } from '../config/db';
import { AppError } from '../utils/AppError';
import { verificarAccesoSucursal } from '../utils/autorizacion.utils';
import { resolverCantidadUnidades } from '../utils/documento.utils';
import { liberarReserva, obtenerReservaPropia, registrarReserva } from './reservas.service';
import type {
  AnularRemitoInput,
  EstadoRemito,
  GenerarRemitoInput,
  Remito,
  RemitoDetalle,
  Rol,
  TipoMovimientoStock,
} from '../types/domain';

/** `pool.query` y `client.query` (dentro de una transacción) comparten esta forma. */
type Queryable = Pool | PoolClient;

export interface ContextoRemito {
  rol: Rol;
  id_sucursal: number;
  id_usuario: number;
}

/**
 * Recalcula `documentos.estado_despacho` sumando `cantidad`/
 * `cantidad_despachada_total` de todos los ítems del documento. Se llama
 * después de cualquier cambio a `documentos_detalles.cantidad_despachada_total`
 * (generar o anular un remito), tanto desde acá como desde
 * `ventas.service.ts` -> `facturarComprobanteInterno`.
 */
export async function recalcularEstadoDespacho(client: PoolClient, id_documento: number): Promise<void> {
  const { rows } = await client.query<{ cantidad_total: string; despachado_total: string }>(
    `SELECT COALESCE(SUM(cantidad), 0) AS cantidad_total, COALESCE(SUM(cantidad_despachada_total), 0) AS despachado_total
     FROM documentos_detalles WHERE id_documento = $1`,
    [id_documento],
  );
  const cantidadTotal = Number(rows[0].cantidad_total);
  const despachadoTotal = Number(rows[0].despachado_total);

  const estado =
    despachadoTotal <= 0 ? 'PENDIENTE' : despachadoTotal >= cantidadTotal ? 'DESPACHADO_TOTAL' : 'DESPACHADO_PARCIAL';

  await client.query(`UPDATE documentos SET estado_despacho = $1 WHERE id_documento = $2`, [estado, id_documento]);
}

async function obtenerDetallesRemito(client: Queryable, id_remito: number): Promise<RemitoDetalle[]> {
  const { rows } = await client.query<RemitoDetalle>(
    `SELECT rd.id_remito_detalle, rd.id_producto, p.sku, p.descripcion, rd.cantidad_despachada
     FROM remitos_detalles rd
     JOIN productos p ON p.id_producto = rd.id_producto
     WHERE rd.id_remito = $1
     ORDER BY rd.id_remito_detalle`,
    [id_remito],
  );
  return rows;
}

export interface DespachoItem {
  id_producto: number;
  /** Ya resuelta en unidades (no kilos) — quien llama resuelve KG->unidades antes. */
  cantidad: number;
}

export interface DespachoDocumentoInput {
  id_documento: number;
  cliente_id: number;
  es_fiscal: boolean;
  /** Sucursal cuyo `stock_sucursal` se descuenta — no necesariamente `documento.id_sucursal_origen` (ver retiro cruzado en `ordenesEntrega.service.ts`). */
  id_sucursal_despacho: number;
  items: DespachoItem[];
  id_camion?: number | null;
  id_chofer?: string | null;
  /** Default `'EMITIDO'`. Un retiro mostrador ya consumado se inserta directo en `'ENTREGADO'`. */
  estado_inicial?: EstadoRemito;
  tipo_movimiento_stock: TipoMovimientoStock;
  /** Texto libre para `stock_movements.comprobante_ref` (ej. `DOCUMENTO:50`, `ORDEN_ENTREGA:12`). */
  comprobante_ref: string;
  id_usuario: number;
  /**
   * Si el documento tiene una reserva PROPIA en la sucursal de despacho
   * (ledger `reservas_stock`), consumir de ahí en vez de chocar contra el
   * límite físico global. Lo activa `generarRemito`: es lo que permite
   * re-emitir el remito corregido después de una Anulación Correctiva (el
   * documento se auto-reservó lo suyo al anular, y ahora despacha contra esa
   * reserva). Default `false` — el retiro inmediato de la venta mixta y el
   * cumplimiento de órdenes (que libera la reserva por su cuenta) no lo usan.
   */
  consumir_reserva_propia?: boolean;
}

/**
 * Núcleo compartido de "descontar stock físico + emitir remito": valida
 * saldo pendiente por ítem contra `documentos_detalles`, valida stock físico
 * en `id_sucursal_despacho`, inserta `remitos`/`remitos_detalles`, descuenta
 * `stock_sucursal.cantidad`, suma `cantidad_despachada_total`, audita cada
 * ítem en `stock_movements` y recalcula `documentos.estado_despacho`.
 *
 * Reutilizado por `generarRemito` (despacho normal, misma sucursal de
 * origen) y por `ordenesEntrega.service.ts` (retiro inmediato de una venta
 * mixta y cierre de un retiro cruzado, ambos potencialmente desde OTRA
 * sucursal). El llamador es responsable de haber lockeado `documentos FOR
 * UPDATE` y validado `verificarAccesoSucursal` antes de invocar esto.
 */
export async function despacharDocumento(client: PoolClient, input: DespachoDocumentoInput): Promise<Remito> {
  const itemsValidados: Array<DespachoItem & { reservaPropia: number }> = [];

  for (const item of input.items) {
    const { rows: detalleRows } = await client.query<{ cantidad: string; cantidad_despachada_total: string }>(
      `SELECT cantidad, cantidad_despachada_total FROM documentos_detalles
       WHERE id_documento = $1 AND id_producto = $2 FOR UPDATE`,
      [input.id_documento, item.id_producto],
    );
    const detalle = detalleRows[0];
    if (!detalle) {
      throw AppError.badRequest(
        'PRODUCTO_NO_PERTENECE_AL_DOCUMENTO',
        `El producto id_producto=${item.id_producto} no pertenece al documento id_documento=${input.id_documento}.`,
      );
    }

    const saldo = Number(detalle.cantidad) - Number(detalle.cantidad_despachada_total);
    if (item.cantidad > saldo) {
      throw AppError.conflict(
        'SALDO_EXCEDIDO',
        `El ítem id_producto=${item.id_producto} sólo tiene ${saldo} unidades pendientes de despacho.`,
      );
    }

    const { rows: stockRows } = await client.query<{ cantidad: string; cantidad_reservada: string }>(
      `SELECT cantidad, cantidad_reservada FROM stock_sucursal WHERE id_producto = $1 AND id_sucursal = $2 FOR UPDATE`,
      [item.id_producto, input.id_sucursal_despacho],
    );
    const filaStock = stockRows[0];
    const fisico = filaStock ? Number(filaStock.cantidad) : 0;
    const reservadoTotal = filaStock ? Number(filaStock.cantidad_reservada) : 0;

    // Cuánto de lo reservado en (producto, sucursal) es reserva PROPIA de este
    // documento. Sólo se mira si el llamador pidió consumirla; si no, es 0 y
    // el disponible se calcula igual que siempre.
    const reservaPropia = input.consumir_reserva_propia
      ? Math.min(await obtenerReservaPropia(client, input.id_documento, item.id_producto, input.id_sucursal_despacho), item.cantidad)
      : 0;

    // Disponible para ESTE documento = físico - reservas AJENAS. La reserva
    // propia (`reservaPropia`) no se le resta: son unidades que ya tenía
    // apartadas para sí mismo. Sin este ajuste, re-emitir el remito corregido
    // tras una Anulación Correctiva chocaría contra su propia reserva.
    const stockDisponible = fisico - (reservadoTotal - reservaPropia);
    if (item.cantidad > stockDisponible) {
      throw AppError.conflict(
        'STOCK_INSUFICIENTE',
        `El producto id_producto=${item.id_producto} sólo tiene ${stockDisponible} unidades disponibles en stock.`,
      );
    }

    itemsValidados.push({ ...item, reservaPropia });
  }

  const tipoRemito = input.es_fiscal ? 'R' : 'X';
  const { rows: remitoRows } = await client.query<Remito>(
    `INSERT INTO remitos (id_documento_origen, tipo_remito, cliente_id, id_sucursal, id_camion, id_chofer, estado)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id_remito, nro_remito, id_documento_origen, tipo_remito, id_remito_origen_x, es_regularizacion_stock,
               estado, cliente_id, id_sucursal, id_camion, id_chofer, fecha_emision, motivo_anulacion,
               id_usuario_anulo, fecha_anulacion`,
    [
      input.id_documento,
      tipoRemito,
      input.cliente_id,
      input.id_sucursal_despacho,
      input.id_camion ?? null,
      input.id_chofer ?? null,
      input.estado_inicial ?? 'EMITIDO',
    ],
  );
  const remito = remitoRows[0];

  for (const item of itemsValidados) {
    await client.query(`INSERT INTO remitos_detalles (id_remito, id_producto, cantidad_despachada) VALUES ($1, $2, $3)`, [
      remito.id_remito,
      item.id_producto,
      item.cantidad,
    ]);

    // La liberación de la reserva propia va ANTES de bajar el físico: el CHECK
    // `cantidad_reservada <= cantidad` se evalúa por statement, y si primero
    // bajáramos el físico (10->5) con la reserva todavía en 6, esa fila
    // intermedia lo violaría. Bajando la reserva primero (6->1), el físico
    // puede caer sin romper el invariante en ningún paso.
    if (item.reservaPropia > 0) {
      await liberarReserva(client, {
        id_documento: input.id_documento,
        id_producto: item.id_producto,
        id_sucursal: input.id_sucursal_despacho,
        cantidad: item.reservaPropia,
        comprobante_ref: input.comprobante_ref,
        id_usuario: input.id_usuario,
        tipo_movimiento: 'RESERVA_LIBERADA',
      });
    }

    await client.query(
      `UPDATE stock_sucursal SET cantidad = cantidad - $1, actualizado_en = NOW()
       WHERE id_producto = $2 AND id_sucursal = $3`,
      [item.cantidad, item.id_producto, input.id_sucursal_despacho],
    );
    await client.query(
      `UPDATE documentos_detalles SET cantidad_despachada_total = cantidad_despachada_total + $1
       WHERE id_documento = $2 AND id_producto = $3`,
      [item.cantidad, input.id_documento, item.id_producto],
    );
    await client.query(
      `INSERT INTO stock_movements (id_producto, id_sucursal, tipo_movimiento, cantidad, comprobante_ref, id_usuario)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [item.id_producto, input.id_sucursal_despacho, input.tipo_movimiento_stock, item.cantidad, input.comprobante_ref, input.id_usuario],
    );
  }

  await recalcularEstadoDespacho(client, input.id_documento);

  remito.detalles = await obtenerDetallesRemito(client, remito.id_remito);
  return remito;
}

/**
 * Genera un Remito (tipo 'R' si el documento origen es fiscal, 'X' si es un
 * Comprobante Interno) por una entrega parcial o total, descontando stock y
 * sumando `cantidad_despachada_total` por ítem. Ver
 * `sql/010_remitos.sql` para el caso de uso obligatorio "5 -> 4 -> 3+2"
 * (anular + generar encadenados, cada uno en su propia transacción).
 */
export async function generarRemito(input: GenerarRemitoInput, contexto: ContextoRemito): Promise<Remito> {
  if (!Number.isInteger(input.id_documento)) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'id_documento es requerido y debe ser un entero.');
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'El remito debe tener al menos un ítem.');
  }
  for (const item of input.items) {
    if (!Number.isInteger(item.id_producto) || item.cantidad <= 0) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'Cada ítem requiere id_producto válido y cantidad positiva.');
    }
  }

  return withTransaction(async (client) => {
    const { rows: documentoRows } = await client.query<{
      id_documento: number;
      cliente_id: number;
      id_sucursal_origen: number;
      es_fiscal: boolean;
      tipo_documento: string;
    }>(
      `SELECT id_documento, cliente_id, id_sucursal_origen, es_fiscal, tipo_documento
       FROM documentos WHERE id_documento = $1 FOR UPDATE`,
      [input.id_documento],
    );
    const documento = documentoRows[0];
    if (!documento) {
      throw AppError.notFound('DOCUMENTO_NO_ENCONTRADO', `No existe el documento id_documento=${input.id_documento}`);
    }
    verificarAccesoSucursal(contexto, documento.id_sucursal_origen);
    if (documento.tipo_documento === 'PRESUPUESTO') {
      throw AppError.badRequest(
        'DOCUMENTO_NO_FACTURADO',
        'Un presupuesto no puede remitirse; primero hay que facturarlo.',
      );
    }

    // Resuelve KG->unidades contra el peso_teorico_kg de cada línea; la
    // validación de saldo/stock y la mutación quedan a cargo de
    // `despacharDocumento`.
    const itemsResueltos: DespachoItem[] = [];
    for (const item of input.items) {
      const { rows: detalleRows } = await client.query<{ peso_teorico_kg: string; sku: string }>(
        `SELECT peso_teorico_kg, sku FROM documentos_detalles WHERE id_documento = $1 AND id_producto = $2`,
        [input.id_documento, item.id_producto],
      );
      const detalle = detalleRows[0];
      if (!detalle) {
        throw AppError.badRequest(
          'PRODUCTO_NO_PERTENECE_AL_DOCUMENTO',
          `El producto id_producto=${item.id_producto} no pertenece al documento id_documento=${input.id_documento}.`,
        );
      }
      const cantidad = resolverCantidadUnidades(
        item.cantidad,
        item.unidad_ingreso ?? 'U',
        Number(detalle.peso_teorico_kg),
        detalle.sku,
      );
      itemsResueltos.push({ id_producto: item.id_producto, cantidad });
    }

    return despacharDocumento(client, {
      id_documento: documento.id_documento,
      cliente_id: documento.cliente_id,
      es_fiscal: documento.es_fiscal,
      id_sucursal_despacho: documento.id_sucursal_origen,
      items: itemsResueltos,
      id_camion: input.id_camion,
      id_chofer: input.id_chofer,
      tipo_movimiento_stock: 'DESPACHO_LOCAL',
      comprobante_ref: `DOCUMENTO:${documento.id_documento}`,
      id_usuario: contexto.id_usuario,
      // Si el documento se auto-reservó lo suyo (p.ej. tras una Anulación
      // Correctiva), consumir de esa reserva en vez de chocar contra el físico.
      consumir_reserva_propia: true,
    });
  });
}

/**
 * Anula un remito "emitido no entregado" (Anulación Correctiva). Los remitos
 * son inmutables: no se editan, se anulan. Al anular:
 *  - Inmutabilidad: el remito pasa a `ANULADO`, nunca se borra.
 *  - Reversión física: se devuelve el stock a la sucursal, salvo que sea una
 *    regularización (`es_regularizacion_stock`, ver `facturarComprobanteInterno`,
 *    que nunca descontó físico).
 *  - Restitución del saldo pendiente del documento origen (baja
 *    `cantidad_despachada_total`) para poder re-emitir el remito corregido.
 *  - Restitución virtual: se vuelve a reservar esa misma cantidad ATADA al
 *    documento (ledger `reservas_stock`), para que las unidades devueltas
 *    queden apartadas para él y no se las lleve otra venta mientras se corrige.
 *    Al re-emitir, `generarRemito` (con `consumir_reserva_propia`) despacha
 *    contra esa reserva propia sin chocar contra el límite físico global. Es
 *    lo que resuelve el "facturé/remití 6, en el portón entraron 5" y el
 *    clásico encadenado "5 -> 4 -> 3+2".
 */
export async function anularRemito(
  id_remito: number,
  contexto: ContextoRemito,
  input: AnularRemitoInput,
): Promise<Remito> {
  if (!input.motivo || !input.motivo.trim()) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'motivo es requerido para anular un remito.');
  }

  return withTransaction(async (client) => {
    const { rows: remitoRows } = await client.query<Remito>(
      `SELECT id_remito, nro_remito, id_documento_origen, tipo_remito, id_remito_origen_x, es_regularizacion_stock,
              estado, cliente_id, id_sucursal, id_camion, id_chofer, fecha_emision, motivo_anulacion,
              id_usuario_anulo, fecha_anulacion
       FROM remitos WHERE id_remito = $1 FOR UPDATE`,
      [id_remito],
    );
    const remito = remitoRows[0];
    if (!remito) {
      throw AppError.notFound('REMITO_NO_ENCONTRADO', `No existe el remito id_remito=${id_remito}`);
    }
    verificarAccesoSucursal(contexto, remito.id_sucursal);
    if (remito.estado === 'ANULADO') {
      throw AppError.badRequest('REMITO_YA_ANULADO', 'El remito ya está anulado.');
    }
    if (remito.estado === 'ENTREGADO') {
      throw AppError.conflict('REMITO_ENTREGADO', 'Un remito entregado no puede anularse.');
    }

    const detalles = await obtenerDetallesRemito(client, id_remito);
    for (const detalle of detalles) {
      if (!remito.es_regularizacion_stock) {
        await client.query(
          `UPDATE stock_sucursal SET cantidad = cantidad + $1, actualizado_en = NOW()
           WHERE id_producto = $2 AND id_sucursal = $3`,
          [detalle.cantidad_despachada, detalle.id_producto, remito.id_sucursal],
        );
        await client.query(
          `INSERT INTO stock_movements (id_producto, id_sucursal, tipo_movimiento, cantidad, comprobante_ref, id_usuario)
           VALUES ($1, $2, 'ANULACION_REMITO', $3, $4, $5)`,
          [detalle.id_producto, remito.id_sucursal, detalle.cantidad_despachada, `REMITO:${id_remito}`, contexto.id_usuario],
        );
        // Restitución virtual: re-reservar lo devuelto, atado al documento.
        // Es siempre válido contra el CHECK (reservada <= físico): acabamos de
        // sumar esa misma cantidad al físico, así que no puede excederlo.
        await registrarReserva(client, {
          id_documento: remito.id_documento_origen,
          id_producto: detalle.id_producto,
          id_sucursal: remito.id_sucursal,
          cantidad: Number(detalle.cantidad_despachada),
          comprobante_ref: `REMITO:${id_remito}`,
          id_usuario: contexto.id_usuario,
        });
      }
      await client.query(
        `UPDATE documentos_detalles SET cantidad_despachada_total = cantidad_despachada_total - $1
         WHERE id_documento = $2 AND id_producto = $3`,
        [detalle.cantidad_despachada, remito.id_documento_origen, detalle.id_producto],
      );
    }

    await recalcularEstadoDespacho(client, remito.id_documento_origen);

    const { rows: actualizadoRows } = await client.query<Remito>(
      `UPDATE remitos SET estado = 'ANULADO', motivo_anulacion = $1, id_usuario_anulo = $2, fecha_anulacion = NOW()
       WHERE id_remito = $3
       RETURNING id_remito, nro_remito, id_documento_origen, tipo_remito, id_remito_origen_x, es_regularizacion_stock,
                 estado, cliente_id, id_sucursal, id_camion, id_chofer, fecha_emision, motivo_anulacion,
                 id_usuario_anulo, fecha_anulacion`,
      [input.motivo, contexto.id_usuario, id_remito],
    );
    const actualizado = actualizadoRows[0];
    actualizado.detalles = detalles;
    return actualizado;
  });
}

export async function listarRemitosPorDocumento(id_documento: number, contexto: ContextoRemito): Promise<Remito[]> {
  const { rows } = await pool.query<Remito>(
    `SELECT id_remito, nro_remito, id_documento_origen, tipo_remito, id_remito_origen_x, es_regularizacion_stock,
            estado, cliente_id, id_sucursal, id_camion, id_chofer, fecha_emision, motivo_anulacion,
            id_usuario_anulo, fecha_anulacion
     FROM remitos WHERE id_documento_origen = $1 ORDER BY fecha_emision DESC`,
    [id_documento],
  );
  const filtrados = contexto.rol === 'VENDEDOR' ? rows.filter((r) => r.id_sucursal === contexto.id_sucursal) : rows;
  for (const remito of filtrados) {
    remito.detalles = await obtenerDetallesRemito(pool, remito.id_remito);
  }
  return filtrados;
}

/**
 * Por cada Remito X no anulado del Comprobante Interno, crea un Remito R
 * gemelo de regularización (`es_regularizacion_stock:true`) enlazado a la
 * nueva Factura fiscal, SIN volver a descontar stock — la mercadería ya
 * salió físicamente con el X. Ver `ventas.service.ts` -> `facturarComprobanteInterno`.
 */
export async function crearRemitosRegularizacion(
  client: PoolClient,
  params: { id_documento_ci: number; id_documento_factura: number; cliente_id: number; id_sucursal: number },
): Promise<Remito[]> {
  const { rows: remitosX } = await client.query<{ id_remito: number; id_camion: number | null; id_chofer: string | null }>(
    `SELECT id_remito, id_camion, id_chofer FROM remitos
     WHERE id_documento_origen = $1 AND tipo_remito = 'X' AND estado != 'ANULADO'`,
    [params.id_documento_ci],
  );

  const creados: Remito[] = [];
  for (const remitoX of remitosX) {
    const detallesX = await obtenerDetallesRemito(client, remitoX.id_remito);

    const { rows: nuevoRows } = await client.query<Remito>(
      `INSERT INTO remitos (id_documento_origen, tipo_remito, id_remito_origen_x, es_regularizacion_stock,
                             cliente_id, id_sucursal, id_camion, id_chofer)
       VALUES ($1, 'R', $2, TRUE, $3, $4, $5, $6)
       RETURNING id_remito, nro_remito, id_documento_origen, tipo_remito, id_remito_origen_x, es_regularizacion_stock,
                 estado, cliente_id, id_sucursal, id_camion, id_chofer, fecha_emision, motivo_anulacion,
                 id_usuario_anulo, fecha_anulacion`,
      [
        params.id_documento_factura,
        remitoX.id_remito,
        params.cliente_id,
        params.id_sucursal,
        remitoX.id_camion,
        remitoX.id_chofer,
      ],
    );
    const nuevo = nuevoRows[0];

    for (const detalle of detallesX) {
      await client.query(
        `INSERT INTO remitos_detalles (id_remito, id_producto, cantidad_despachada) VALUES ($1, $2, $3)`,
        [nuevo.id_remito, detalle.id_producto, detalle.cantidad_despachada],
      );
    }
    nuevo.detalles = detallesX;
    creados.push(nuevo);
  }
  return creados;
}
