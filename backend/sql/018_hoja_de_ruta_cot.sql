-- =============================================================================
-- 018_hoja_de_ruta_cot.sql
--
-- El COT (Código de Operación de Traslado, exigido por ARBA) no pertenece a
-- la venta ni al documento de transporte por separado: pertenece al VIAJE
-- físico del camión. Una Hoja de Ruta puede agrupar varias Órdenes de
-- Entrega (varios remitos) en un mismo viaje — así que el COT se carga UNA
-- vez por Hoja de Ruta, no por remito.
--
-- Esto migra la responsabilidad que hasta ahora tenía `envios.nro_cot`
-- (Control de Ruteo, `011_choferes_cot.sql`) hacia el nuevo circuito de la
-- Pizarra de Camiones, que pasa a ser la única fuente de verdad para
-- despachos por camión. La tabla `envios` y su columna `nro_cot` quedan
-- intactas por ahora (Control de Ruteo se retira en un paso aparte, junto
-- con su pantalla) — esto sólo agrega la capacidad nueva.
-- =============================================================================

ALTER TABLE hojas_de_ruta ADD COLUMN IF NOT EXISTS nro_cot VARCHAR(20);
