import type { TipoDocumento } from '../types/domain';

/**
 * Determina el tipo de comprobante según la longitud del `cuit_dni` del
 * cliente: CUIT (11 dígitos) -> Factura A, DNI (7 u 8 dígitos) -> Factura B.
 */
export function tipoDocumentoPorIdentificacion(cuitDni: string): Extract<TipoDocumento, 'FACTURA_A' | 'FACTURA_B'> {
  const digitos = cuitDni.replace(/\D/g, '');
  if (digitos.length === 11) return 'FACTURA_A';
  if (digitos.length === 7 || digitos.length === 8) return 'FACTURA_B';
  throw new Error(
    `No se pudo determinar el tipo de comprobante: "${cuitDni}" no es un CUIT (11 dígitos) ni un DNI (7-8 dígitos) válido.`,
  );
}

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
