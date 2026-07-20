-- =============================================================================
-- 001_extend_schema.sql
-- Extensión ADITIVA del esquema base provisto.
--
-- El DDL base (sucursales, clientes, cuentas_empresa, sucursales_secuencias,
-- documentos, cuenta_corriente) no incluye algunas columnas que son
-- imprescindibles para que las reglas de negocio descritas funcionen:
--
--   1. `documentos` no distingue tipo de comprobante (Presupuesto / Factura A /
--      Factura B). El trigger que asigna `nro_remito` bloquea una fila de
--      `sucursales_secuencias` por (id_sucursal, tipo_documento), por lo que
--      la tabla `documentos` debe poder informar ese `tipo_documento` en el
--      INSERT para que el trigger sepa qué secuencia incrementar.
--   2. `documentos` no tiene forma de guardar el detalle de items (material,
--      kilos, precio) de la venta. Se agrega una columna JSONB en vez de una
--      tabla nueva para no romper la forma del modelo entregado.
--   3. `cuenta_corriente` no tiene manera de saber a qué documento pertenece
--      un movimiento, ni (para los HABER) con qué medio de pago
--      (`cuentas_empresa`) se canceló. Sin esto no se puede implementar el
--      desglose de pago mixto pedido.
--
-- Todas las sentencias son idempotentes (IF NOT EXISTS) y no tocan las
-- columnas, triggers ni constraints ya existentes.
-- =============================================================================

ALTER TABLE documentos
  ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(20) NOT NULL DEFAULT 'FACTURA_B';

ALTER TABLE documentos
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE cuenta_corriente
  ADD COLUMN IF NOT EXISTS id_documento INTEGER NULL REFERENCES documentos(id_documento);

ALTER TABLE cuenta_corriente
  ADD COLUMN IF NOT EXISTS id_cuenta INTEGER NULL REFERENCES cuentas_empresa(id_cuenta);

ALTER TABLE cuenta_corriente
  ADD COLUMN IF NOT EXISTS concepto VARCHAR(255) NULL;

CREATE INDEX IF NOT EXISTS idx_cuenta_corriente_cliente ON cuenta_corriente(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cuenta_corriente_documento ON cuenta_corriente(id_documento);
CREATE INDEX IF NOT EXISTS idx_documentos_cliente ON documentos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_documentos_sucursal ON documentos(id_sucursal_origen);
