-- =============================================================================
-- 009_documentos_detalles.sql
-- Migra los ítems de `documentos.items` (JSONB) a una tabla relacional. Es
-- el prerequisito real del módulo de remitos: sin una fila por ítem no hay
-- dónde trackear `cantidad_despachada_total` para las entregas parciales
-- (ver épico de Remitos — punto 1, `documentos_detalles`).
--
-- `sku`, `descripcion`, `unidad_venta` y `peso_teorico_kg` quedan
-- congelados (snapshot) al momento de facturar, igual que ya hacía el JSONB
-- — si el producto cambia de nombre o de modo de venta después, un remito
-- viejo no cambia retroactivamente.
--
-- Envuelto en un chequeo de "¿todavía existe la columna items?" para que
-- este archivo sea re-ejecutable sin duplicar filas ni romper en una
-- segunda pasada (mismo criterio que el resto de las migraciones).
-- =============================================================================

CREATE TABLE IF NOT EXISTS documentos_detalles (
  id_documento_detalle SERIAL PRIMARY KEY,
  id_documento INTEGER NOT NULL REFERENCES documentos(id_documento),
  id_producto INTEGER NOT NULL REFERENCES productos(id_producto),
  sku VARCHAR(30) NOT NULL,
  descripcion VARCHAR(255) NOT NULL,
  unidad_venta unidad_venta_producto NOT NULL,
  cantidad NUMERIC(12, 3) NOT NULL CHECK (cantidad > 0),
  peso_teorico_kg NUMERIC(10, 3) NOT NULL DEFAULT 0 CHECK (peso_teorico_kg >= 0),
  precio_unitario NUMERIC(14, 2) NOT NULL CHECK (precio_unitario > 0),
  subtotal NUMERIC(14, 2) NOT NULL CHECK (subtotal >= 0),
  -- Saldo de entrega parcial: nunca puede despacharse más de lo comprado.
  cantidad_despachada_total NUMERIC(12, 3) NOT NULL DEFAULT 0
    CHECK (cantidad_despachada_total >= 0 AND cantidad_despachada_total <= cantidad)
);

CREATE INDEX IF NOT EXISTS idx_documentos_detalles_documento ON documentos_detalles(id_documento);
CREATE INDEX IF NOT EXISTS idx_documentos_detalles_producto ON documentos_detalles(id_producto);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'documentos' AND column_name = 'items') THEN
    INSERT INTO documentos_detalles (id_documento, id_producto, sku, descripcion, unidad_venta, cantidad, peso_teorico_kg, precio_unitario, subtotal)
    SELECT
      d.id_documento,
      (item->>'id_producto')::INTEGER,
      item->>'sku',
      item->>'descripcion',
      (item->>'unidad_venta')::unidad_venta_producto,
      (item->>'cantidad')::NUMERIC,
      (item->>'peso_teorico_kg')::NUMERIC,
      (item->>'precio_unitario')::NUMERIC,
      (item->>'subtotal')::NUMERIC
    FROM documentos d, jsonb_array_elements(d.items) AS item
    WHERE d.items IS NOT NULL AND jsonb_array_length(d.items) > 0 AND item ? 'id_producto';

    ALTER TABLE documentos DROP COLUMN items;
  END IF;
END $$;
