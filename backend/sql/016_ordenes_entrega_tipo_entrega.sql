-- =============================================================================
-- 016_ordenes_entrega_tipo_entrega.sql
--
-- Distingue la INTENCIÓN de cumplimiento de una Orden de Entrega Pendiente
-- (`014_ordenes_entrega_stock.sql`): retiro por el cliente en cualquier
-- sucursal (mostrador) vs. envío a domicilio (Pizarra de Camiones,
-- `015_hojas_de_ruta.sql`). No cambia ninguna mecánica de stock — las dos
-- son la MISMA reserva, cumplible por cualquiera de los dos caminos ya
-- construidos (`retirarOrdenEntrega`/`confirmarSalidaHojaDeRuta`); esto es
-- sólo un dato informativo cargado al vender, para que logística no tenga
-- que llamar al cliente a preguntarle si venía a buscarlo o hay que
-- llevárselo.
--
-- Aplica a la orden completa (no por renglón/producto): una venta mixta
-- sólo genera una Orden de Entrega Pendiente por vez, y toda esa reserva
-- comparte una única intención de cumplimiento.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE tipo_entrega_orden AS ENUM ('RETIRO_CLIENTE', 'ENVIO_DOMICILIO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE ordenes_entrega ADD COLUMN IF NOT EXISTS tipo_entrega tipo_entrega_orden NOT NULL DEFAULT 'RETIRO_CLIENTE';
ALTER TABLE ordenes_entrega ADD COLUMN IF NOT EXISTS direccion_envio TEXT;
ALTER TABLE ordenes_entrega ADD COLUMN IF NOT EXISTS fecha_pactada_envio DATE;

DO $$ BEGIN
  ALTER TABLE ordenes_entrega ADD CONSTRAINT chk_ordenes_entrega_tipo_entrega_valido
    CHECK (
      (tipo_entrega = 'RETIRO_CLIENTE' AND direccion_envio IS NULL AND fecha_pactada_envio IS NULL)
      OR (tipo_entrega = 'ENVIO_DOMICILIO' AND direccion_envio IS NOT NULL AND fecha_pactada_envio IS NOT NULL)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
