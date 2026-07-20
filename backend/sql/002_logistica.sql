-- =============================================================================
-- 002_logistica.sql
-- Módulo de Logística y Despacho de Camiones: zonas, camiones y envíos.
--
-- Reglas de negocio:
--   - Cada cliente pertenece a una zona (Cercana/Media/Lejana, configurable).
--     La zona se copia al documento en el momento de facturar (snapshot),
--     igual que el resto de la cabecera, para que el reparto de un remito
--     ya facturado no cambie si más adelante se reconfigura la zona del
--     cliente.
--   - Un camión tiene una capacidad diaria fija en "casilleros" (slots) y en
--     kilos. Cada zona consume una cantidad de casilleros distinta según la
--     distancia (más lejos = más casilleros = menos envíos posibles ese día).
--   - `envios` asigna un documento (remito) a un camión en una fecha de
--     despacho puntual, y snapshotea cuántos casilleros y kilos consumió en
--     ese momento (aunque cambie la capacidad del camión o la zona después).
-- =============================================================================

CREATE TABLE IF NOT EXISTS zonas (
  id_zona SERIAL PRIMARY KEY,
  nombre VARCHAR(50) NOT NULL UNIQUE,
  casilleros_requeridos INTEGER NOT NULL CHECK (casilleros_requeridos > 0)
);

CREATE TABLE IF NOT EXISTS camiones (
  id_camion SERIAL PRIMARY KEY,
  patente VARCHAR(10) NOT NULL UNIQUE,
  chofer VARCHAR(100) NOT NULL,
  capacidad_casilleros INTEGER NOT NULL CHECK (capacidad_casilleros > 0),
  capacidad_kilos_max NUMERIC(10, 2) NOT NULL CHECK (capacidad_kilos_max > 0)
);

CREATE TABLE IF NOT EXISTS envios (
  id_envio SERIAL PRIMARY KEY,
  id_camion INTEGER NOT NULL REFERENCES camiones(id_camion),
  id_documento INTEGER NOT NULL UNIQUE REFERENCES documentos(id_documento),
  fecha_despacho DATE NOT NULL,
  casilleros_ocupados INTEGER NOT NULL CHECK (casilleros_ocupados > 0),
  kilos_asignados NUMERIC(10, 2) NOT NULL CHECK (kilos_asignados > 0)
);

CREATE INDEX IF NOT EXISTS idx_envios_camion_fecha ON envios(id_camion, fecha_despacho);

-- `id_zona` en clientes: nullable porque los clientes existentes no tienen
-- zona asignada todavía. `id_zona` en documentos: snapshot copiado desde el
-- cliente en el momento de facturar (ver ventas.service.ts).
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS id_zona INTEGER NULL REFERENCES zonas(id_zona);
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS id_zona INTEGER NULL REFERENCES zonas(id_zona);

INSERT INTO zonas (nombre, casilleros_requeridos) VALUES
  ('Zona Cercana', 1),
  ('Zona Media', 2),
  ('Zona Lejana', 3)
ON CONFLICT (nombre) DO NOTHING;
