-- =============================================================================
-- Cuentas de sistema faltantes para el servicio de emisión de Órdenes de
-- Pago (`ordenesPago.service.ts`) y el retrofit de asientos automáticos en
-- facturas/notas de crédito de proveedor (`facturasProveedor.service.ts`,
-- `notasCreditoProveedor.service.ts`).
--
-- No se toca `012_cuentas_por_pagar.sql` (ya mergeado): este archivo sólo
-- agrega filas al `plan_cuentas` ya existente, con el mismo patrón de
-- 2 pasadas + `ON CONFLICT (codigo) DO NOTHING` que usa el seed original.
--
-- - `5.2`/`5.2.01` Compras de Mercadería: la Provisión de Pasivo al cargar
--   una factura de proveedor debita esta cuenta (más IVA Crédito Fiscal),
--   y una nota de crédito la acredita — ninguna de las dos existía todavía.
-- - `2.2.04` Retención SUSS a Pagar: el CHECK de
--   `op_retenciones.tipo_retencion` ya admite 'SUSS' desde
--   `012_cuentas_por_pagar.sql`, pero nunca se sembró la cuenta contable
--   correspondiente.
-- =============================================================================

INSERT INTO plan_cuentas (codigo, nombre, id_cuenta_padre, tipo, imputable, es_sistema)
SELECT v.codigo, v.nombre, padre.id_cuenta_contable, v.tipo::tipo_cuenta_contable, FALSE, TRUE
FROM (VALUES
  ('5.2', 'Compras y Gastos', 'RESULTADO_NEGATIVO', '5')
) AS v(codigo, nombre, tipo, codigo_padre)
JOIN plan_cuentas padre ON padre.codigo = v.codigo_padre
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO plan_cuentas (codigo, nombre, id_cuenta_padre, tipo, imputable, es_sistema)
SELECT v.codigo, v.nombre, padre.id_cuenta_contable, v.tipo::tipo_cuenta_contable, TRUE, TRUE
FROM (VALUES
  ('5.2.01', 'Compras de Mercadería', 'RESULTADO_NEGATIVO', '5.2'),
  ('2.2.04', 'Retención SUSS a Pagar', 'PASIVO', '2.2')
) AS v(codigo, nombre, tipo, codigo_padre)
JOIN plan_cuentas padre ON padre.codigo = v.codigo_padre
ON CONFLICT (codigo) DO NOTHING;
