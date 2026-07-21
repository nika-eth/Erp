import type { Pool, PoolClient } from 'pg';
import { pool, withTransaction } from '../config/db';
import { AppError } from '../utils/AppError';
import type { AnularRemitoInput, GenerarRemitoInput, Remito, RemitoDetalle } from '../types/domain';

/** `pool.query` y `client.query` (dentro de una transacción) comparten esta forma. */
type Queryable = Pool | PoolClient;

export interface ContextoRemito {
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

/**
 * Genera un Remito (tipo 'R' si el documento origen es fiscal, 'X' si es un
 * Comprobante Interno) por una entrega parcial o total, descontando stock y
 * sumando `cantidad_despachada_total` por ítem. Ver
 * `sql/010_remitos.sql` para el caso de uso obligatorio "5 -> 4 -> 3+2"
 * (anular + generar encadenados, cada uno en su propia transacción).
 */
export async function generarRemito(input: GenerarRemitoInput): Promise<Remito> {
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
    if (documento.tipo_documento === 'PRESUPUESTO') {
      throw AppError.badRequest(
        'DOCUMENTO_NO_FACTURADO',
        'Un presupuesto no puede remitirse; primero hay que facturarlo.',
      );
    }

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

      const { rows: stockRows } = await client.query<{ cantidad: string }>(
        `SELECT cantidad FROM stock_sucursal WHERE id_producto = $1 AND id_sucursal = $2 FOR UPDATE`,
        [item.id_producto, documento.id_sucursal_origen],
      );
      const stockDisponible = Number(stockRows[0]?.cantidad ?? 0);
      if (item.cantidad > stockDisponible) {
        throw AppError.conflict(
          'STOCK_INSUFICIENTE',
          `El producto id_producto=${item.id_producto} sólo tiene ${stockDisponible} unidades en stock.`,
        );
      }
    }

    const tipoRemito = documento.es_fiscal ? 'R' : 'X';
    const { rows: remitoRows } = await client.query<Remito>(
      `INSERT INTO remitos (id_documento_origen, tipo_remito, cliente_id, id_sucursal, id_camion, id_chofer)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id_remito, nro_remito, id_documento_origen, tipo_remito, id_remito_origen_x, es_regularizacion_stock,
                 estado, cliente_id, id_sucursal, id_camion, id_chofer, fecha_emision, motivo_anulacion,
                 id_usuario_anulo, fecha_anulacion`,
      [
        documento.id_documento,
        tipoRemito,
        documento.cliente_id,
        documento.id_sucursal_origen,
        input.id_camion ?? null,
        input.id_chofer ?? null,
      ],
    );
    const remito = remitoRows[0];

    for (const item of input.items) {
      await client.query(
        `INSERT INTO remitos_detalles (id_remito, id_producto, cantidad_despachada) VALUES ($1, $2, $3)`,
        [remito.id_remito, item.id_producto, item.cantidad],
      );
      await client.query(
        `UPDATE stock_sucursal SET cantidad = cantidad - $1, actualizado_en = NOW()
         WHERE id_producto = $2 AND id_sucursal = $3`,
        [item.cantidad, item.id_producto, documento.id_sucursal_origen],
      );
      await client.query(
        `UPDATE documentos_detalles SET cantidad_despachada_total = cantidad_despachada_total + $1
         WHERE id_documento = $2 AND id_producto = $3`,
        [item.cantidad, input.id_documento, item.id_producto],
      );
    }

    await recalcularEstadoDespacho(client, input.id_documento);

    remito.detalles = await obtenerDetallesRemito(client, remito.id_remito);
    return remito;
  });
}

/**
 * Anula un remito "emitido no entregado", devolviendo el stock salvo que sea
 * una regularización (`es_regularizacion_stock`, ver
 * `facturarComprobanteInterno`), y liberando el saldo pendiente del
 * documento origen para poder re-emitir (caso "5 -> 4 -> 3+2").
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

export async function listarRemitosPorDocumento(id_documento: number): Promise<Remito[]> {
  const { rows } = await pool.query<Remito>(
    `SELECT id_remito, nro_remito, id_documento_origen, tipo_remito, id_remito_origen_x, es_regularizacion_stock,
            estado, cliente_id, id_sucursal, id_camion, id_chofer, fecha_emision, motivo_anulacion,
            id_usuario_anulo, fecha_anulacion
     FROM remitos WHERE id_documento_origen = $1 ORDER BY fecha_emision DESC`,
    [id_documento],
  );
  for (const remito of rows) {
    remito.detalles = await obtenerDetallesRemito(pool, remito.id_remito);
  }
  return rows;
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
