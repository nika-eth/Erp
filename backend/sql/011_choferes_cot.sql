-- =============================================================================
-- Ampliación mínima de logística: Código de Operación de Traslado (COT,
-- exigido por ARBA) por envío, y una tabla `choferes` propia creada de cara
-- al futuro (todavía no referenciada desde ningún lado — `camiones.chofer`
-- sigue siendo el campo de texto simple que ya usa Control de Ruteo, F4).
--
-- Se descartó explícitamente construir la "Pizarra de Carga" (Kanban por
-- camión sobre `remitos.id_camion`) que pedía el épico original: F4/`envios`
-- sigue siendo la única pantalla de asignación a camión, con su control de
-- capacidad de kilos/casilleros intacto. Este archivo sólo agrega el campo
-- de COT sobre `envios` (el registro real de "qué remito va en qué camión
-- qué día" en el sistema hoy).
-- =============================================================================

CREATE TABLE IF NOT EXISTS choferes (
  id_chofer SERIAL PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  cuit VARCHAR(20),
  telefono VARCHAR(50),
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE envios ADD COLUMN IF NOT EXISTS nro_cot VARCHAR(20);
