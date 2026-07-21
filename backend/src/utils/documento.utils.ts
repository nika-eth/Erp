import type { TipoDocumento } from '../types/domain';

/** Redondea a 2 decimales evitando errores de coma flotante en montos. */
export function redondearMoneda(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/** Etiqueta legible para mostrar en conceptos de cuenta_corriente y UI. */
export const ETIQUETA_TIPO_DOCUMENTO: Record<TipoDocumento, string> = {
  FACTURA_A: 'Factura A',
  FACTURA_B: 'Factura B',
  PRESUPUESTO: 'Presupuesto',
};

/**
 * Columnas base de `documentos` (sin `items`: ahora vive en
 * `documentos_detalles`, ver `sql/009_documentos_detalles.sql`). Sirve tal
 * cual en `INSERT/UPDATE ... RETURNING` sin alias — ahí `items` se adjunta
 * en JS con el array ya calculado en memoria (`ventas.service.ts`), no hace
 * falta reconsultarlo. Para un SELECT que sí necesita traer `items` desde
 * cero (lecturas en `documentos.service.ts`), combinar con
 * `subconsultaItems(alias)`.
 */
export const DOCUMENTO_COLUMNAS = `
  id_documento, id_sucursal_origen, nro_remito, fecha, cliente_id, total_neto, tipo_documento, id_zona,
  es_fiscal, tipo_comprobante, punto_venta, nro_comprobante_afip, cae, cae_vencimiento, estado_afip, error_afip_mensaje,
  id_documento_origen_ci, estado_facturacion_interna, estado_despacho
`;

/**
 * Subconsulta que arma `items` como un array JSON agregando
 * `documentos_detalles`, con la misma forma que `ItemDocumento`. `alias` es
 * el alias de tabla de `documentos` en el SELECT que la usa (ej. `d`).
 */
export function subconsultaItems(alias: string): string {
  return `COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id_producto', dd.id_producto,
      'sku', dd.sku,
      'descripcion', dd.descripcion,
      'unidad_venta', dd.unidad_venta,
      'cantidad', dd.cantidad,
      'peso_teorico_kg', dd.peso_teorico_kg,
      'kilos', ROUND(dd.cantidad * dd.peso_teorico_kg, 2),
      'precio_unitario', dd.precio_unitario,
      'subtotal', dd.subtotal,
      'cantidad_despachada_total', dd.cantidad_despachada_total
    ) ORDER BY dd.id_documento_detalle)
    FROM documentos_detalles dd
    WHERE dd.id_documento = ${alias}.id_documento
  ), '[]'::jsonb) AS items`;
}
