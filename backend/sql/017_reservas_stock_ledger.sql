-- =============================================================================
-- 017_reservas_stock_ledger.sql
--
-- Ledger de reservas POR DOCUMENTO. Hasta acá `stock_sucursal.cantidad_reservada`
-- (014) era un contador agregado y anónimo por (producto, sucursal): sabía
-- CUÁNTO había reservado, pero no DE QUIÉN era cada porción. Esa granularidad
-- alcanzaba para la venta y el retiro, pero no para la "Anulación Correctiva"
-- de un remito: al anular hay que restituir el saldo pendiente del documento
-- Y volver a reservar exactamente lo que ese documento tenía, para poder
-- re-emitir el remito corregido (el clásico "facturé 6, en el portón entraron
-- 5") consumiendo de la reserva propia sin chocar contra el límite físico
-- global.
--
-- INVARIANTE que este ledger mantiene, y del que dependen todas las
-- validaciones de stock disponible:
--     stock_sucursal.cantidad_reservada
--       == COALESCE(SUM(reservas_stock.cantidad), 0)   -- por (producto, sucursal)
--
-- Toda operación que toque `cantidad_reservada` (crear reserva en la venta
-- mixta, liberarla al retirar/anular una orden, consumirla al despachar,
-- restituirla al anular un remito) pasa por los helpers de
-- `reservas.service.ts`, que actualizan ambas caras en la misma transacción.
--
-- `stock_movements` (014) sigue siendo la auditoría append-only inmutable;
-- `reservas_stock` es el estado ACTUAL (saldo vivo) de cada reserva.
-- =============================================================================

CREATE TABLE IF NOT EXISTS reservas_stock (
  id_reserva SERIAL PRIMARY KEY,
  id_documento INTEGER NOT NULL REFERENCES documentos(id_documento),
  id_producto INTEGER NOT NULL REFERENCES productos(id_producto),
  id_sucursal INTEGER NOT NULL REFERENCES sucursales(id_sucursal),
  cantidad NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Un documento tiene a lo sumo una fila de reserva por (producto, sucursal):
  -- el saldo se acumula/decrementa sobre esa misma fila (upsert), nunca se
  -- insertan filas paralelas para el mismo trío. Habilita el ON CONFLICT de
  -- `registrarReserva`.
  UNIQUE (id_documento, id_producto, id_sucursal)
);

-- Búsqueda de la reserva propia de un documento al despachar/consumir
-- (reservas.service.ts -> despacharDocumento con consumir_reserva_propia).
CREATE INDEX IF NOT EXISTS idx_reservas_stock_documento ON reservas_stock(id_documento);
-- Reconstrucción del agregado por (producto, sucursal) para auditar el invariante.
CREATE INDEX IF NOT EXISTS idx_reservas_stock_producto_sucursal ON reservas_stock(id_producto, id_sucursal);
