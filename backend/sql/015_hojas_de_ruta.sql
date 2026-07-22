-- =============================================================================
-- 015_hojas_de_ruta.sql
--
-- Pizarra de Camiones: incremento 2 de Gestión de Stock Multi-Sucursal
-- (Flujo C — entrega por logística). Agrupa varias Órdenes de Entrega
-- Pendientes (`ordenes_entrega`, ver `014_ordenes_entrega_stock.sql`) en un
-- mismo viaje de camión, con su propio ciclo de vida: se arma en `BORRADOR`
-- (agregar/quitar órdenes, validar capacidad) SIN tocar stock, y recién al
-- confirmar la salida (`EN_TRANSITO`) se descuenta stock físico + libera
-- reservas + emiten remitos, en lote, para todas las órdenes del viaje en
-- una única transacción.
--
-- No reemplaza a `envios`/`camiones` (ver `002_logistica.sql`): ese circuito
-- sigue existiendo tal cual para documentos facturados con la venta simple
-- (`facturarVenta`, sin `procesarVentaMixta`) que nunca generan una
-- `orden_entrega` — no tienen stock reservado que liberar. Las Hojas de
-- Ruta son un circuito nuevo y paralelo, específico para despachar Órdenes
-- de Entrega Pendientes.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE estado_hoja_de_ruta AS ENUM ('BORRADOR', 'EN_TRANSITO', 'ANULADA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS hojas_de_ruta (
  id_hoja_de_ruta SERIAL PRIMARY KEY,
  id_camion INTEGER NOT NULL REFERENCES camiones(id_camion),
  chofer VARCHAR(100),
  fecha_despacho DATE NOT NULL,
  estado estado_hoja_de_ruta NOT NULL DEFAULT 'BORRADOR',
  id_usuario_creo INTEGER NOT NULL,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  id_usuario_confirmo INTEGER,
  fecha_confirmacion TIMESTAMPTZ,
  motivo_anulacion TEXT,
  id_usuario_anulo INTEGER,
  fecha_anulacion TIMESTAMPTZ
);

-- Una orden sólo puede estar en UNA hoja de ruta a la vez (UNIQUE); si se
-- la quita o se anula la hoja, se borra esta fila y la orden vuelve a
-- estar disponible para otro viaje (la hoja anulada queda como historial).
CREATE TABLE IF NOT EXISTS hoja_de_ruta_ordenes (
  id_hoja_de_ruta_orden SERIAL PRIMARY KEY,
  id_hoja_de_ruta INTEGER NOT NULL REFERENCES hojas_de_ruta(id_hoja_de_ruta),
  id_orden_entrega INTEGER NOT NULL UNIQUE REFERENCES ordenes_entrega(id_orden_entrega),
  id_sucursal_despacho INTEGER NOT NULL REFERENCES sucursales(id_sucursal),
  casilleros_ocupados INTEGER NOT NULL CHECK (casilleros_ocupados > 0),
  kilos_asignados NUMERIC(10, 2) NOT NULL CHECK (kilos_asignados > 0),
  agregado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hoja_de_ruta_ordenes_hoja ON hoja_de_ruta_ordenes(id_hoja_de_ruta);
CREATE INDEX IF NOT EXISTS idx_hojas_de_ruta_camion_fecha ON hojas_de_ruta(id_camion, fecha_despacho);
