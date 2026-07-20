-- =============================================================================
-- 008_clientes_fiscal.sql
-- Reemplaza `clientes.cuit_dni` (un solo campo de texto, se adivinaba si era
-- CUIT o DNI contando dígitos) por `tipo_documento` + `numero_documento`
-- explícitos, y agrega `condicion_iva` (regla de negocio AFIP: DNI sólo
-- puede ser Consumidor Final; CUIT nunca puede ser Consumidor Final) más los
-- datos de contacto del ABM de clientes.
--
-- La validación cruzada tipo_documento/condicion_iva y el dígito
-- verificador del CUIT (Módulo 11) se hacen en el backend
-- (`clientes.service.ts` -> `crearCliente`), no acá: mantiene la regla de
-- negocio en un solo lugar, testeable sin necesitar la base.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_documento_cliente') THEN
    CREATE TYPE tipo_documento_cliente AS ENUM ('DNI', 'CUIT');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'condicion_iva_cliente') THEN
    CREATE TYPE condicion_iva_cliente AS ENUM ('CONSUMIDOR_FINAL', 'RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO');
  END IF;
END $$;

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tipo_documento tipo_documento_cliente;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS numero_documento VARCHAR(20);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS condicion_iva condicion_iva_cliente;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS direccion VARCHAR(255);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS telefono VARCHAR(30);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email VARCHAR(150);

-- Backfill de filas cargadas antes de este migration (con la vieja
-- `cuit_dni`): mismo criterio de longitud que usaba el código hasta ahora.
-- No hay forma de recuperar la condición IVA real de un cliente ya
-- cargado, así que se asume la más conservadora por tipo de documento.
UPDATE clientes SET
  tipo_documento = (CASE WHEN length(regexp_replace(cuit_dni, '\D', '', 'g')) = 11 THEN 'CUIT' ELSE 'DNI' END)::tipo_documento_cliente,
  numero_documento = regexp_replace(cuit_dni, '\D', '', 'g'),
  condicion_iva = (CASE WHEN length(regexp_replace(cuit_dni, '\D', '', 'g')) = 11 THEN 'RESPONSABLE_INSCRIPTO' ELSE 'CONSUMIDOR_FINAL' END)::condicion_iva_cliente
WHERE tipo_documento IS NULL AND cuit_dni IS NOT NULL;

ALTER TABLE clientes ALTER COLUMN tipo_documento SET NOT NULL;
ALTER TABLE clientes ALTER COLUMN numero_documento SET NOT NULL;
ALTER TABLE clientes ALTER COLUMN condicion_iva SET NOT NULL;

ALTER TABLE clientes DROP COLUMN IF EXISTS cuit_dni;
ALTER TABLE clientes ADD CONSTRAINT clientes_numero_documento_key UNIQUE (numero_documento);
