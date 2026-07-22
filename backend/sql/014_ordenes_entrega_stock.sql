-- =============================================================================
-- 014_ordenes_entrega_stock.sql
--
-- Reservas de stock y Órdenes de Entrega Pendiente (retiro cruzado entre
-- sucursales). Incremento 1 de 2 del módulo de Gestión de Stock
-- Multi-Sucursal: cubre la venta mixta (renglones de retiro inmediato +
-- renglones que quedan reservados para retirar después, en cualquier
-- sucursal) y el ciclo de vida de una orden pendiente (creación -> retiro ->
-- remito definitivo, o anulación sin despacho). La integración con
-- logística/camiones (entrega por envío) queda para un incremento aparte:
-- `envios`/`camiones` no se tocan acá.
--
-- Los 3 pilares de stock por (producto, sucursal), sobre la ya existente
-- `stock_sucursal` (ver `007_productos_stock.sql`):
--   stock_fisico     -> stock_sucursal.cantidad (sin cambios)
--   stock_reservado  -> stock_sucursal.cantidad_reservada (nueva, este archivo)
--   stock_disponible -> cantidad - cantidad_reservada, calculado en cada
--                        consulta (mismo criterio disperso que ya usa el
--                        resto de esta tabla; no es una columna generada).
-- =============================================================================

ALTER TABLE stock_sucursal ADD COLUMN IF NOT EXISTS cantidad_reservada NUMERIC(12, 3) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE stock_sucursal ADD CONSTRAINT chk_stock_sucursal_reservado_valido
    CHECK (cantidad_reservada >= 0 AND cantidad_reservada <= cantidad);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE estado_orden_entrega AS ENUM ('PENDIENTE', 'RETIRADA', 'ANULADA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Una Orden de Entrega Pendiente representa mercadería YA VENDIDA (reservada
-- en `id_sucursal_origen`) que el cliente todavía no retiró. A diferencia de
-- un Remito (que siempre documenta un despacho YA CONSUMADO), esta tabla es
-- una promesa pendiente de cumplir, retirable desde cualquier sucursal — no
-- necesariamente la de origen. El retiro es todo-o-nada por renglón: no hay
-- retiro parcial de una orden (ver `ordenesEntrega.service.ts`).
CREATE TABLE IF NOT EXISTS ordenes_entrega (
  id_orden_entrega SERIAL PRIMARY KEY,
  nro_orden VARCHAR(20) UNIQUE,
  id_documento INTEGER NOT NULL REFERENCES documentos(id_documento),
  id_sucursal_origen INTEGER NOT NULL REFERENCES sucursales(id_sucursal),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id_cliente),
  estado estado_orden_entrega NOT NULL DEFAULT 'PENDIENTE',
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  id_usuario_creo INTEGER NOT NULL,
  id_sucursal_retiro INTEGER REFERENCES sucursales(id_sucursal),
  id_usuario_retiro INTEGER,
  fecha_retiro TIMESTAMPTZ,
  id_remito_retiro INTEGER REFERENCES remitos(id_remito),
  motivo_anulacion TEXT,
  id_usuario_anulo INTEGER,
  fecha_anulacion TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ordenes_entrega_detalles (
  id_orden_entrega_detalle SERIAL PRIMARY KEY,
  id_orden_entrega INTEGER NOT NULL REFERENCES ordenes_entrega(id_orden_entrega),
  id_producto INTEGER NOT NULL REFERENCES productos(id_producto),
  cantidad NUMERIC(12, 3) NOT NULL CHECK (cantidad > 0)
);

CREATE INDEX IF NOT EXISTS idx_ordenes_entrega_documento ON ordenes_entrega(id_documento);
CREATE INDEX IF NOT EXISTS idx_ordenes_entrega_pendientes ON ordenes_entrega(estado) WHERE estado = 'PENDIENTE';
CREATE INDEX IF NOT EXISTS idx_ordenes_entrega_detalles_orden ON ordenes_entrega_detalles(id_orden_entrega);

-- Numeración: mismo patrón ON CONFLICT DO UPDATE sobre `sucursales_secuencias`
-- que ya usan `fn_asignar_remito` (documentos) y `fn_asignar_nro_remito`
-- (remitos), con partición propia 'ORDEN_ENTREGA'. Formato 'OE-<sucursal>-000042'.
CREATE OR REPLACE FUNCTION fn_asignar_nro_orden_entrega() RETURNS TRIGGER AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  INSERT INTO sucursales_secuencias (id_sucursal, tipo_documento, ultimo_numero)
  VALUES (NEW.id_sucursal_origen, 'ORDEN_ENTREGA', 1)
  ON CONFLICT (id_sucursal, tipo_documento)
  DO UPDATE SET ultimo_numero = sucursales_secuencias.ultimo_numero + 1
  RETURNING ultimo_numero INTO v_numero;

  NEW.nro_orden := 'OE-' || NEW.id_sucursal_origen || '-' || LPAD(v_numero::text, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asignar_nro_orden_entrega ON ordenes_entrega;
CREATE TRIGGER trg_asignar_nro_orden_entrega
  BEFORE INSERT ON ordenes_entrega
  FOR EACH ROW EXECUTE FUNCTION fn_asignar_nro_orden_entrega();

-- Auditoría inmutable de todo movimiento de stock (físico o de reserva).
-- Nunca se actualiza ni se borra una fila existente; revertir un movimiento
-- (ej. anular una reserva) inserta una fila nueva que lo compensa.
DO $$ BEGIN
  CREATE TYPE tipo_movimiento_stock AS ENUM (
    'VENTA_DIRECTA',
    'RESERVA_CREADA',
    'RESERVA_LIBERADA',
    'RESERVA_ANULADA',
    'DESPACHO_LOCAL',
    'DESPACHO_CRUZADO',
    'ANULACION_REMITO'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS stock_movements (
  id_movimiento SERIAL PRIMARY KEY,
  id_producto INTEGER NOT NULL REFERENCES productos(id_producto),
  id_sucursal INTEGER NOT NULL REFERENCES sucursales(id_sucursal),
  tipo_movimiento tipo_movimiento_stock NOT NULL,
  cantidad NUMERIC(12, 3) NOT NULL CHECK (cantidad > 0),
  comprobante_ref VARCHAR(50) NOT NULL,
  id_usuario INTEGER NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_producto_sucursal ON stock_movements(id_producto, id_sucursal);
