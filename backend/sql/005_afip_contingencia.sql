-- =============================================================================
-- 005_afip_contingencia.sql
-- Integración con AFIP (WSFE v1) + Cola de Contingencia Offline.
--
-- Principio rector: la venta en mostrador NUNCA se revierte por una falla de
-- AFIP. `documentos` guarda el resultado fiscal como un dato más de la fila
-- (no como un requisito de la transacción); si AFIP no responde a tiempo,
-- queda en estado CONTINGENCIA y un worker en segundo plano la sincroniza
-- después (ver `src/afip/contingencia.worker.ts`).
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_afip_documento') THEN
    CREATE TYPE estado_afip_documento AS ENUM ('PENDIENTE', 'APROBADO', 'CONTINGENCIA', 'RECHAZADO');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_tarea_afip') THEN
    CREATE TYPE estado_tarea_afip AS ENUM ('PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'FALLIDO');
  END IF;
END $$;

-- `estado_afip` es NULL para documentos que no son fiscales (PRESUPUESTO):
-- no aplica, no es "pendiente de sincronizar". Sólo FACTURA_A/FACTURA_B lo
-- setean al facturar.
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS tipo_comprobante INTEGER NULL;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS punto_venta INTEGER NULL;
-- Número de comprobante AFIP intentado/confirmado (distinto de `nro_remito`,
-- que es la numeración interna propia). Se persiste apenas se obtiene de
-- FECompUltimoAutorizado, ANTES de llamar a FECAESolicitar, para que un
-- reintento posterior pueda consultar por este número puntual (idempotencia).
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS nro_comprobante_afip INTEGER NULL;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS cae VARCHAR(14) NULL;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS cae_vencimiento DATE NULL;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS estado_afip estado_afip_documento NULL;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS error_afip_mensaje TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_documentos_estado_afip ON documentos(estado_afip) WHERE estado_afip IS NOT NULL;

-- Task queue persistente: una fila por documento que entró en contingencia
-- (o fue rechazado). `proximo_reintento` + `estado` son lo que consulta el
-- worker; `FOR UPDATE SKIP LOCKED` sobre esta tabla permite en el futuro
-- correr más de una instancia del worker sin procesar la misma tarea dos
-- veces.
CREATE TABLE IF NOT EXISTS cola_facturacion_afip (
  id_tarea SERIAL PRIMARY KEY,
  id_documento INTEGER NOT NULL UNIQUE REFERENCES documentos(id_documento),
  reintentos INTEGER NOT NULL DEFAULT 0,
  proximo_reintento TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estado estado_tarea_afip NOT NULL DEFAULT 'PENDIENTE',
  ultimo_error TEXT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cola_afip_pendientes ON cola_facturacion_afip(proximo_reintento) WHERE estado = 'PENDIENTE';
