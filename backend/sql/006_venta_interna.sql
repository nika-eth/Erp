-- =============================================================================
-- 006_venta_interna.sql
-- Facturación dual: Venta Fiscal (AFIP) vs. Venta Interna (Remito X / no
-- fiscal), elegida por el vendedor al confirmar el cobro (F5/F6 en Rendición
-- de Pago).
--
-- Un documento con `es_fiscal = FALSE` nunca toca WSAA/WSFE ni la cola de
-- contingencia: queda resuelto en el momento, en el mismo request. Reutiliza
-- la numeración correlativa que ya existía (`nro_remito`, vía
-- `sucursales_secuencias`) — es independiente de la numeración fiscal de
-- AFIP porque nunca comparte `(punto_venta, tipo_comprobante)` con una
-- Factura A/B real: se le asigna el punto de venta convencional "interno"
-- (`AFIP_PUNTO_VENTA_INTERNO`, 0 por defecto) y `tipo_comprobante = 91`
-- (Remito X), sólo como metadato descriptivo — no se vuelve a pedir CAE con
-- esos valores en ningún punto del código.
-- =============================================================================

ALTER TABLE documentos ADD COLUMN IF NOT EXISTS es_fiscal BOOLEAN NOT NULL DEFAULT TRUE;

-- Estado terminal propio para ventas internas: no es "pendiente de
-- sincronizar" (CONTINGENCIA) ni un resultado de AFIP (APROBADO/RECHAZADO) —
-- es un documento que nunca fue a AFIP y no tiene por qué hacerlo.
ALTER TYPE estado_afip_documento ADD VALUE IF NOT EXISTS 'APROBADO_INTERNO';

CREATE INDEX IF NOT EXISTS idx_documentos_no_fiscales ON documentos(es_fiscal) WHERE es_fiscal = FALSE;
