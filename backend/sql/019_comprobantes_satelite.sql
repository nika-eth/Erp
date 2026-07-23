-- =============================================================================
-- 019_comprobantes_satelite.sql
-- Polimorfismo de comprobantes: separa los metadatos específicos de AFIP
-- (Operación FISCAL) de los de Comprobante Interno (Operación INTERNA) en
-- tablas satélite propias, en vez de columnas nullable compartidas en
-- `documentos`. `documentos` sigue siendo la cabecera agnóstica (cliente,
-- total, ítems, sucursal, despacho) — el stock y las reservas ya se
-- descuentan contra ella sin mirar `es_fiscal` (ver `ventas.service.ts`),
-- eso no cambia acá.
--
-- `tipo_operacion` es una columna generada a partir de `es_fiscal` (que se
-- conserva: lo sigue leyendo `hojasDeRuta.service.ts`/`ordenesEntrega.service.ts`
-- sin cambios) — sólo para que el dato tenga nombre de negocio en consultas
-- ad-hoc, no reemplaza al booleano.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS comprobantes_afip (
  id_documento INTEGER PRIMARY KEY REFERENCES documentos(id_documento),
  tipo_comprobante INTEGER,
  punto_venta INTEGER,
  nro_comprobante_afip INTEGER,
  cae VARCHAR(14),
  cae_vencimiento DATE,
  estado_afip estado_afip_documento NOT NULL,
  error_afip_mensaje TEXT
);

CREATE TABLE IF NOT EXISTS comprobantes_internos (
  id_documento INTEGER PRIMARY KEY REFERENCES documentos(id_documento),
  correlativo_interno VARCHAR(30) NOT NULL,
  estado_facturacion_interna VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
);

-- Backfill de documentos ya existentes + DROP de las columnas viejas, todo
-- adentro de un bloque condicional: si ya se corrió esta migración antes
-- (las columnas ya no están en `documentos`), no hace nada. Sin este guard,
-- reaplicar el archivo fallaría con "column does not exist" al llegar acá,
-- porque el backfill referencia columnas que la propia migración borra al
-- final. PL/pgSQL sólo prepara/valida el SQL de una rama cuando esa rama
-- efectivamente se ejecuta, así que el `IF` de abajo evita ese error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documentos' AND column_name = 'tipo_comprobante'
  ) THEN
    INSERT INTO comprobantes_afip (id_documento, tipo_comprobante, punto_venta, nro_comprobante_afip, cae, cae_vencimiento, estado_afip, error_afip_mensaje)
    SELECT id_documento, tipo_comprobante, punto_venta, nro_comprobante_afip, cae, cae_vencimiento,
           COALESCE(estado_afip, 'PENDIENTE'), error_afip_mensaje
    FROM documentos
    WHERE es_fiscal = TRUE
    ON CONFLICT (id_documento) DO NOTHING;

    INSERT INTO comprobantes_internos (id_documento, correlativo_interno, estado_facturacion_interna)
    SELECT id_documento, 'X-' || COALESCE(nro_remito::text, id_documento::text), COALESCE(estado_facturacion_interna, 'PENDIENTE')
    FROM documentos
    WHERE es_fiscal = FALSE
    ON CONFLICT (id_documento) DO NOTHING;

    ALTER TABLE documentos
      DROP COLUMN tipo_comprobante,
      DROP COLUMN punto_venta,
      DROP COLUMN nro_comprobante_afip,
      DROP COLUMN cae,
      DROP COLUMN cae_vencimiento,
      DROP COLUMN estado_afip,
      DROP COLUMN error_afip_mensaje,
      DROP COLUMN estado_facturacion_interna;
  END IF;
END $$;

ALTER TABLE documentos ADD COLUMN IF NOT EXISTS tipo_operacion VARCHAR(8)
  GENERATED ALWAYS AS (CASE WHEN es_fiscal THEN 'FISCAL' ELSE 'INTERNA' END) STORED;

COMMIT;
