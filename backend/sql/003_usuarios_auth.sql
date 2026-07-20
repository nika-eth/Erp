-- =============================================================================
-- 003_usuarios_auth.sql
-- Autenticación real, roles y autorización de supervisor (override de
-- límite de crédito) en mostrador.
--
-- IMPORTANTE sobre el paso 3 (el CREATE OR REPLACE del trigger de límite de
-- crédito): no tenemos el código fuente del trigger real que ya corre en tu
-- base ("Ya hay dos triggers corriendo en la BD"), sólo la descripción de su
-- comportamiento. Este script reemplaza una función llamada
-- `fn_validar_limite_credito()` (el nombre que usamos para reconstruirlo y
-- probarlo en nuestro entorno de test) agregándole el chequeo de
-- `current_setting('app.allow_credit_override', true)` al principio.
--
-- ANTES DE CORRER ESTE SCRIPT EN TU BASE REAL: verificá el nombre de la
-- función asociada al trigger BEFORE INSERT de `cuenta_corriente` con
--   SELECT tgname, tgfoid::regproc FROM pg_trigger WHERE tgrelid = 'cuenta_corriente'::regclass;
-- Si el nombre real es distinto de `fn_validar_limite_credito`, reemplazalo
-- en la sentencia de abajo (conservando el resto de tu lógica de negocio
-- intacta; sólo se agrega el `IF ... RETURN NEW` al principio de la
-- función). Si preferís no tocar el trigger todavía, podés aplicar sólo las
-- secciones 1 y 2 de este archivo.
-- =============================================================================

-- -----------------------------------------------------------------------
-- 1. Usuarios y roles
-- -----------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rol_usuario') THEN
    CREATE TYPE rol_usuario AS ENUM ('ADMIN', 'SUPERVISOR', 'VENDEDOR');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  usuario VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  pin_autorizacion_hash VARCHAR(255), -- hash del PIN de 4 dígitos, sólo relevante para SUPERVISOR/ADMIN
  rol rol_usuario NOT NULL DEFAULT 'VENDEDOR',
  id_sucursal INTEGER REFERENCES sucursales(id_sucursal),
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

-- -----------------------------------------------------------------------
-- 2. Auditoría de autorizaciones de supervisor (override de crédito)
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auditoria_autorizaciones (
  id_autorizacion SERIAL PRIMARY KEY,
  id_usuario_vendedor INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  id_supervisor INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  id_cliente INTEGER NOT NULL REFERENCES clientes(id_cliente),
  monto_excedido NUMERIC(14, 2) NOT NULL CHECK (monto_excedido >= 0),
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_autorizaciones_cliente ON auditoria_autorizaciones(id_cliente);

-- -----------------------------------------------------------------------
-- 3. Override de límite de crédito en el trigger existente
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_validar_limite_credito() RETURNS TRIGGER AS $$
DECLARE
  v_saldo_actual NUMERIC;
  v_limite NUMERIC;
BEGIN
  -- El controller de facturación setea esta variable con SET LOCAL (sólo
  -- válida dentro de la transacción actual) cuando un supervisor autorizó
  -- la venta con su PIN pese a superar el límite de crédito del cliente.
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
