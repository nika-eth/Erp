-- =============================================================================
-- 007_productos_stock.sql
-- Catálogo real de productos + stock por sucursal, primer paso del Módulo de
-- Logística/Remitos. Reemplaza (a futuro) al catálogo hardcodeado
-- `src/data/catalogoMateriales.ts`.
--
-- `unidad_venta` decide cómo se calcula el subtotal en el mostrador:
--   KILO   -> subtotal = (cantidad * peso_teorico_kg) * precio_unitario  (precio en $/kg)
--   UNIDAD -> subtotal = cantidad * precio_unitario                     (precio en $/unidad)
-- `peso_teorico_kg` sigue existiendo en AMBOS modos porque también alimenta
-- el cálculo de kilos físicos para logística (capacidad de camión). Para un
-- producto UNIDAD sin peso conocido todavía, queda en 0 — ver ADVERTENCIA
-- en el importador (`scripts/importar-productos.ts`): el Excel de origen no
-- trae ningún dato de peso.
--
-- ADVERTENCIA: esta migración NO conecta todavía `productos`/`stock_sucursal`
-- con Carga Unificada ni con `facturarVenta` — el mostrador sigue usando el
-- catálogo hardcodeado hasta que se defina el modo de venta dual ahí. Este
-- es sólo el cimiento de datos.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'unidad_venta_producto') THEN
    CREATE TYPE unidad_venta_producto AS ENUM ('KILO', 'UNIDAD');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS productos (
  id_producto SERIAL PRIMARY KEY,
  sku VARCHAR(30) NOT NULL UNIQUE,
  descripcion VARCHAR(255) NOT NULL,
  unidad_venta unidad_venta_producto NOT NULL,
  peso_teorico_kg NUMERIC(10, 3) NOT NULL DEFAULT 0 CHECK (peso_teorico_kg >= 0),
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

-- Sparse a propósito: sin fila para (producto, sucursal) el stock es 0
-- implícito (COALESCE en las consultas), no hace falta pre-sembrar todas las
-- combinaciones cada vez que se crea un producto o una sucursal nueva.
CREATE TABLE IF NOT EXISTS stock_sucursal (
  id_producto INTEGER NOT NULL REFERENCES productos(id_producto),
  id_sucursal INTEGER NOT NULL REFERENCES sucursales(id_sucursal),
  cantidad NUMERIC(12, 3) NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_producto, id_sucursal)
);
