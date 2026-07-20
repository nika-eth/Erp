-- =============================================================================
-- 004_recibos.sql
-- Ficha Contable de Cuenta Corriente (F9) y Emisión de Recibos de Cobranza.
--
-- IMPORTANTE sobre `sucursales_secuencias.tipo_documento`: si en tu base
-- real esa columna es un ENUM (no VARCHAR libre), agregale el valor
-- 'RECIBO' antes de correr este script, por ejemplo:
--   ALTER TYPE <nombre_del_enum> ADD VALUE 'RECIBO';
-- (reemplazá <nombre_del_enum> por el tipo real; se puede ver con
--  \d sucursales_secuencias en psql). Si la columna ya es VARCHAR, no hace
-- falta hacer nada.
--
-- Nota sobre `nro_recibo`: el pedido original lo marca como UNIQUE a secas,
-- pero también pide que sea "correlativo por sucursal" (como nro_remito),
-- lo que en este esquema significa que dos sucursales distintas pueden
-- tener válidamente un recibo #1 cada una. Por eso la unicidad se aplica
-- sobre el par (id_sucursal, nro_recibo), no sobre nro_recibo solo.
-- =============================================================================

CREATE TABLE IF NOT EXISTS recibos (
  id_recibo SERIAL PRIMARY KEY,
  nro_recibo INTEGER,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id_cliente),
  id_sucursal INTEGER NOT NULL REFERENCES sucursales(id_sucursal),
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  monto_total NUMERIC(14, 2) NOT NULL CHECK (monto_total > 0),
  id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  UNIQUE (id_sucursal, nro_recibo)
);

CREATE TABLE IF NOT EXISTS recibos_detalles_pago (
  id_detalle SERIAL PRIMARY KEY,
  id_recibo INTEGER NOT NULL REFERENCES recibos(id_recibo),
  id_cuenta INTEGER NOT NULL REFERENCES cuentas_empresa(id_cuenta),
  monto NUMERIC(14, 2) NOT NULL CHECK (monto > 0),
  nro_comprobante VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_recibos_cliente ON recibos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_recibos_detalles_recibo ON recibos_detalles_pago(id_recibo);

-- Enlaza el HABER que cancela/reduce la deuda en `cuenta_corriente` con el
-- recibo que lo originó (mismo patrón que `id_documento` para las ventas).
ALTER TABLE cuenta_corriente ADD COLUMN IF NOT EXISTS id_recibo INTEGER NULL REFERENCES recibos(id_recibo);

-- Asigna nro_recibo correlativo por sucursal reutilizando la misma tabla y
-- el mismo patrón de bloqueo (ON CONFLICT DO UPDATE) que ya usa el trigger
-- de nro_remito sobre `sucursales_secuencias`, con tipo_documento = 'RECIBO'.
CREATE OR REPLACE FUNCTION fn_asignar_nro_recibo() RETURNS TRIGGER AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  INSERT INTO sucursales_secuencias (id_sucursal, tipo_documento, ultimo_numero)
  VALUES (NEW.id_sucursal, 'RECIBO', 1)
  ON CONFLICT (id_sucursal, tipo_documento)
  DO UPDATE SET ultimo_numero = sucursales_secuencias.ultimo_numero + 1
  RETURNING ultimo_numero INTO v_numero;

  NEW.nro_recibo := v_numero;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asignar_nro_recibo ON recibos;
CREATE TRIGGER trg_asignar_nro_recibo
  BEFORE INSERT ON recibos
  FOR EACH ROW EXECUTE FUNCTION fn_asignar_nro_recibo();
