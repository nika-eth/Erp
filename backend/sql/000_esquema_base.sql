-- =============================================================================
-- 000_esquema_base.sql
-- Esquema base del ERP: `sucursales`, `clientes`, `cuentas_empresa`,
-- `sucursales_secuencias`, `documentos`, `cuenta_corriente`, y los dos
-- triggers de los que dependen (`fn_asignar_remito`, numeración correlativa;
-- `fn_validar_limite_credito`, límite de crédito).
--
-- Hasta ahora estas tablas se trataban como "preexistentes, caja negra"
-- (nunca se crearon en este repo, se asumían provistas). Como todavía no
-- existe ninguna base real, este archivo las crea desde cero — es el primer
-- migration que hay que aplicar, ANTES de 001_extend_schema.sql en adelante
-- (todos los siguientes son `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` sobre
-- lo que se crea acá).
--
-- Decisión de diseño (antes ambigua, ver comentario en
-- `ventas.service.ts` -> `guardarPresupuesto`): `fn_asignar_remito`
-- particiona la numeración de `sucursales_secuencias` por
-- `tipo_documento` (igual que ya hace `fn_asignar_nro_recibo` en
-- 004_recibos.sql con 'RECIBO'), así que un Presupuesto consume su propio
-- contador y no quema numeración de remitos de venta reales.
-- =============================================================================

-- -----------------------------------------------------------------------
-- 1. Catálogos base
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sucursales (
  id_sucursal SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS clientes (
  id_cliente SERIAL PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  cuit_dni VARCHAR(20) NOT NULL UNIQUE,
  limite_credito NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (limite_credito >= 0)
);

CREATE TABLE IF NOT EXISTS cuentas_empresa (
  id_cuenta SERIAL PRIMARY KEY,
  nombre_cuenta VARCHAR(100) NOT NULL
);

-- -----------------------------------------------------------------------
-- 2. Numeración correlativa por sucursal + tipo de documento
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sucursales_secuencias (
  id_sucursal INTEGER NOT NULL REFERENCES sucursales(id_sucursal),
  tipo_documento VARCHAR(20) NOT NULL,
  ultimo_numero INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (id_sucursal, tipo_documento)
);

-- -----------------------------------------------------------------------
-- 3. Documentos (cabecera de Presupuesto/Factura) y Cuenta Corriente
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS documentos (
  id_documento SERIAL PRIMARY KEY,
  id_sucursal_origen INTEGER NOT NULL REFERENCES sucursales(id_sucursal),
  nro_remito INTEGER NULL,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id_cliente),
  total_neto NUMERIC(14, 2) NOT NULL CHECK (total_neto >= 0)
);

CREATE TABLE IF NOT EXISTS cuenta_corriente (
  id_movimiento SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id_cliente),
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  debe NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (debe >= 0),
  haber NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (haber >= 0)
);

CREATE INDEX IF NOT EXISTS idx_cuenta_corriente_cliente_base ON cuenta_corriente(cliente_id);

-- -----------------------------------------------------------------------
-- 4. Trigger: numeración correlativa de `nro_remito`
--
-- Reutiliza `sucursales_secuencias` con el mismo patrón `ON CONFLICT DO
-- UPDATE ... RETURNING` que ya usan `fn_asignar_nro_recibo` (004) y que
-- usará el futuro módulo de remitos: evita carreras entre facturaciones
-- concurrentes sin necesitar locks explícitos adicionales.
--
-- ADVERTENCIA de orden de migraciones: el cuerpo de esta función referencia
-- `NEW.tipo_documento`, columna que recién agrega `001_extend_schema.sql`.
-- Postgres no valida columnas de `NEW`/`OLD` al crear la función (late
-- binding de plpgsql), así que esto es válido siempre que se apliquen todas
-- las migraciones en orden (000, 001, 002, ...) antes de insertar el primer
-- documento real.
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_asignar_remito() RETURNS TRIGGER AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  INSERT INTO sucursales_secuencias (id_sucursal, tipo_documento, ultimo_numero)
  VALUES (NEW.id_sucursal_origen, NEW.tipo_documento, 1)
  ON CONFLICT (id_sucursal, tipo_documento)
  DO UPDATE SET ultimo_numero = sucursales_secuencias.ultimo_numero + 1
  RETURNING ultimo_numero INTO v_numero;

  NEW.nro_remito := v_numero;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asignar_remito ON documentos;
CREATE TRIGGER trg_asignar_remito
  BEFORE INSERT ON documentos
  FOR EACH ROW EXECUTE FUNCTION fn_asignar_remito();

-- -----------------------------------------------------------------------
-- 5. Trigger: límite de crédito (con el override de supervisor ya
-- incorporado desde el día uno; ver `verifySupervisorOverride` y
-- `SET LOCAL app.allow_credit_override` en `ventas.service.ts`).
--
-- Cuerpo idéntico al que 003_usuarios_auth.sql ya redeclaraba asumiendo que
-- esta función preexistía: ese `CREATE OR REPLACE` queda como no-op ahora
-- que la definición original vive acá.
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_validar_limite_credito() RETURNS TRIGGER AS $$
DECLARE
  v_saldo_actual NUMERIC;
  v_limite NUMERIC;
BEGIN
  IF current_setting('app.allow_credit_override', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.debe > 0 THEN
    SELECT COALESCE(SUM(debe) - SUM(haber), 0) INTO v_saldo_actual
    FROM cuenta_corriente WHERE cliente_id = NEW.cliente_id;

    SELECT limite_credito INTO v_limite FROM clientes WHERE id_cliente = NEW.cliente_id;

    IF (v_saldo_actual + NEW.debe) > v_limite THEN
      RAISE EXCEPTION 'Limite de credito excedido para el cliente %', NEW.cliente_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validar_limite_credito ON cuenta_corriente;
CREATE TRIGGER trg_validar_limite_credito
  BEFORE INSERT ON cuenta_corriente
  FOR EACH ROW EXECUTE FUNCTION fn_validar_limite_credito();
