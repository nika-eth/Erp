-- =============================================================================
-- Módulo de Remitos (incremento 1: modelo de datos + control de stock).
--
-- Remitos Fiscales ('R', origen documento es_fiscal=true) e Internos ('X',
-- origen Comprobante Interno). Un Remito R "de regularización"
-- (`es_regularizacion_stock=true`) se emite al facturar fiscalmente un CI
-- que ya despachó mercadería con un Remito X: no vuelve a descontar stock,
-- sólo documenta el traspaso de papel fiscal (ver `facturarComprobanteInterno`
-- en `ventas.service.ts`).
--
-- La numeración de `nro_remito` (VARCHAR, propia de esta tabla — no
-- confundir con `documentos.nro_remito`, que es el número de comprobante de
-- venta) reutiliza `sucursales_secuencias` con el mismo patrón
-- `ON CONFLICT DO UPDATE` que ya usan `fn_asignar_remito` (documentos) y
-- `fn_asignar_nro_recibo` (recibos), particionando por
-- tipo_documento = 'REMITO_R' / 'REMITO_X'.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE tipo_remito AS ENUM ('R', 'X');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE estado_remito AS ENUM ('EMITIDO', 'EN_TRANSITO', 'ENTREGADO', 'ANULADO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE estado_despacho_documento AS ENUM ('PENDIENTE', 'DESPACHADO_PARCIAL', 'DESPACHADO_TOTAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS remitos (
  id_remito SERIAL PRIMARY KEY,
  nro_remito VARCHAR(20) UNIQUE,
  id_documento_origen INTEGER NOT NULL REFERENCES documentos(id_documento),
  tipo_remito tipo_remito NOT NULL,
  id_remito_origen_x INTEGER REFERENCES remitos(id_remito),
  es_regularizacion_stock BOOLEAN NOT NULL DEFAULT FALSE,
  estado estado_remito NOT NULL DEFAULT 'EMITIDO',
  cliente_id INTEGER NOT NULL REFERENCES clientes(id_cliente),
  id_sucursal INTEGER NOT NULL REFERENCES sucursales(id_sucursal),
  id_camion INTEGER REFERENCES camiones(id_camion),
  id_chofer VARCHAR(100),
  fecha_emision TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  motivo_anulacion TEXT,
  id_usuario_anulo INTEGER,
  fecha_anulacion TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS remitos_detalles (
  id_remito_detalle SERIAL PRIMARY KEY,
  id_remito INTEGER NOT NULL REFERENCES remitos(id_remito),
  id_producto INTEGER NOT NULL REFERENCES productos(id_producto),
  cantidad_despachada NUMERIC(12, 3) NOT NULL CHECK (cantidad_despachada > 0)
);

CREATE INDEX IF NOT EXISTS idx_remitos_documento_origen ON remitos(id_documento_origen);
CREATE INDEX IF NOT EXISTS idx_remitos_detalles_remito ON remitos_detalles(id_remito);

ALTER TABLE documentos ADD COLUMN IF NOT EXISTS id_documento_origen_ci INTEGER REFERENCES documentos(id_documento);
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS estado_facturacion_interna VARCHAR(20);
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS estado_despacho estado_despacho_documento NOT NULL DEFAULT 'PENDIENTE';

CREATE OR REPLACE FUNCTION fn_asignar_nro_remito() RETURNS TRIGGER AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  INSERT INTO sucursales_secuencias (id_sucursal, tipo_documento, ultimo_numero)
  VALUES (NEW.id_sucursal, 'REMITO_' || NEW.tipo_remito, 1)
  ON CONFLICT (id_sucursal, tipo_documento)
  DO UPDATE SET ultimo_numero = sucursales_secuencias.ultimo_numero + 1
  RETURNING ultimo_numero INTO v_numero;

  NEW.nro_remito := NEW.tipo_remito || '-' || NEW.id_sucursal || '-' || LPAD(v_numero::text, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asignar_nro_remito ON remitos;
CREATE TRIGGER trg_asignar_nro_remito
  BEFORE INSERT ON remitos
  FOR EACH ROW EXECUTE FUNCTION fn_asignar_nro_remito();
