import type { TipoDocumento, TipoDocumentoCliente } from '../types/domain';

/** Multiplicadores del algoritmo Módulo 11 para el dígito verificador del CUIT. */
const MULTIPLICADORES_CUIT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Valida el dígito verificador de un CUIT de 11 dígitos (algoritmo Módulo 11 de AFIP). */
export function esCuitValido(numeroDocumento: string): boolean {
  const digitos = numeroDocumento.replace(/\D/g, '');
  if (digitos.length !== 11) return false;

  const suma = MULTIPLICADORES_CUIT.reduce((acc, mult, i) => acc + mult * Number(digitos[i]), 0);
  const resto = suma % 11;
  const verificador = 11 - resto;
  const digitoEsperado = verificador === 11 ? 0 : verificador === 10 ? null : verificador;

  return digitoEsperado !== null && digitoEsperado === Number(digitos[10]);
}

/** DNI: 7 u 8 dígitos. CUIT: siempre 11. */
export function largoValidoParaTipoDocumento(tipoDocumento: TipoDocumentoCliente, numeroDocumento: string): boolean {
  const digitos = numeroDocumento.replace(/\D/g, '');
  return tipoDocumento === 'CUIT' ? digitos.length === 11 : digitos.length === 7 || digitos.length === 8;
}

/** Un DNI siempre es Factura B; un CUIT siempre es Factura A (esta app no distingue Factura C). */
export function tipoDocumentoVentaPorCliente(
  tipoDocumentoCliente: TipoDocumentoCliente,
): Extract<TipoDocumento, 'FACTURA_A' | 'FACTURA_B'> {
  return tipoDocumentoCliente === 'CUIT' ? 'FACTURA_A' : 'FACTURA_B';
}
