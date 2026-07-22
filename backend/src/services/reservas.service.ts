import type { PoolClient } from 'pg';

/**
 * Ledger de reservas por documento (`sql/017_reservas_stock_ledger.sql`).
 *
 * `stock_sucursal.cantidad_reservada` es el contador agregado y anónimo por
 * (producto, sucursal); `reservas_stock` desagrega ESE mismo total por
 * documento de origen. Estos dos helpers son el ÚNICO lugar que muta la
 * reserva, y mantienen el invariante en cada transacción:
 *
 *     cantidad_reservada == SUM(reservas_stock.cantidad)   -- por (producto, sucursal)
 *
 * Además auditan el movimiento en `stock_movements` (append-only). El
 * llamador es responsable de haber lockeado la fila de `stock_sucursal`
 * (producto, sucursal) `FOR UPDATE` — ese lock es el punto de serialización
 * que evita carreras sobre la reserva.
 */

export interface MovimientoReservaParams {
  id_documento: number;
  id_producto: number;
  id_sucursal: number;
  cantidad: number;
  /** Texto libre para `stock_movements.comprobante_ref` (ej. `DOCUMENTO:50`, `ORDEN_ENTREGA:OE-1-000042`, `REMITO:200`). */
  comprobante_ref: string;
  id_usuario: number;
}

/**
 * Crea (o incrementa, vía upsert) la reserva de un documento sobre
 * (producto, sucursal). El disponible ya lo validó el llamador bajo el lock;
 * acá sólo se aplica el efecto. Movimiento auditado: `RESERVA_CREADA`.
 */
export async function registrarReserva(client: PoolClient, p: MovimientoReservaParams): Promise<void> {
  await client.query(
    `UPDATE stock_sucursal SET cantidad_reservada = cantidad_reservada + $1, actualizado_en = NOW()
     WHERE id_producto = $2 AND id_sucursal = $3`,
    [p.cantidad, p.id_producto, p.id_sucursal],
  );
  await client.query(
    `INSERT INTO reservas_stock (id_documento, id_producto, id_sucursal, cantidad)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id_documento, id_producto, id_sucursal)
     DO UPDATE SET cantidad = reservas_stock.cantidad + EXCLUDED.cantidad, actualizado_en = NOW()`,
    [p.id_documento, p.id_producto, p.id_sucursal, p.cantidad],
  );
  await client.query(
    `INSERT INTO stock_movements (id_producto, id_sucursal, tipo_movimiento, cantidad, comprobante_ref, id_usuario)
     VALUES ($1, $2, 'RESERVA_CREADA', $3, $4, $5)`,
    [p.id_producto, p.id_sucursal, p.cantidad, p.comprobante_ref, p.id_usuario],
  );
}

/**
 * Libera (decrementa) parte o todo de la reserva de un documento sobre
 * (producto, sucursal). `tipo_movimiento` distingue por qué se libera:
 * `RESERVA_LIBERADA` (se cumplió: retiro/despacho/consumo) o `RESERVA_ANULADA`
 * (se canceló la orden sin entregar).
 */
export async function liberarReserva(
  client: PoolClient,
  p: MovimientoReservaParams & { tipo_movimiento: 'RESERVA_LIBERADA' | 'RESERVA_ANULADA' },
): Promise<void> {
  await client.query(
    `UPDATE stock_sucursal SET cantidad_reservada = cantidad_reservada - $1, actualizado_en = NOW()
     WHERE id_producto = $2 AND id_sucursal = $3`,
    [p.cantidad, p.id_producto, p.id_sucursal],
  );
  await client.query(
    `UPDATE reservas_stock SET cantidad = cantidad - $1, actualizado_en = NOW()
     WHERE id_documento = $2 AND id_producto = $3 AND id_sucursal = $4`,
    [p.cantidad, p.id_documento, p.id_producto, p.id_sucursal],
  );
  // `tipo_movimiento` se interpola directo (no como parámetro) para que el
  // literal quede visible en el SQL: viene de una unión cerrada de TypeScript,
  // nunca de entrada del usuario, así que no hay superficie de inyección.
  await client.query(
    `INSERT INTO stock_movements (id_producto, id_sucursal, tipo_movimiento, cantidad, comprobante_ref, id_usuario)
     VALUES ($1, $2, '${p.tipo_movimiento}', $3, $4, $5)`,
    [p.id_producto, p.id_sucursal, p.cantidad, p.comprobante_ref, p.id_usuario],
  );
}

/**
 * Lee el saldo vivo de la reserva propia de un documento sobre
 * (producto, sucursal), lockeando la fila `FOR UPDATE`. Devuelve 0 si el
 * documento no tiene reserva ahí. Lo usa `despacharDocumento` para saber
 * cuánto del despacho consume de la reserva propia (y por ende no vuelve a
 * chocar contra el límite físico global).
 */
export async function obtenerReservaPropia(
  client: PoolClient,
  id_documento: number,
  id_producto: number,
  id_sucursal: number,
): Promise<number> {
  const { rows } = await client.query<{ cantidad: string }>(
    `SELECT cantidad FROM reservas_stock
     WHERE id_documento = $1 AND id_producto = $2 AND id_sucursal = $3 FOR UPDATE`,
    [id_documento, id_producto, id_sucursal],
  );
  return rows[0] ? Number(rows[0].cantidad) : 0;
}
