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

/** Columnas de `documentos` que arma el tipo `Documento` completo (incluye estado fiscal AFIP). Compartida entre ventas.service y documentos.service para no desalinear los SELECT/RETURNING. */
export const DOCUMENTO_COLUMNAS = `
  id_documento, id_sucursal_origen, nro_remito, fecha, cliente_id, total_neto, tipo_documento, items, id_zona,
  es_fiscal, tipo_comprobante, punto_venta, nro_comprobante_afip, cae, cae_vencimiento, estado_afip, error_afip_mensaje
`;
