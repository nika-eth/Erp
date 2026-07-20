import { describe, expect, it } from 'vitest';
import {
  esCuitValido,
  largoValidoParaTipoDocumento,
  tipoDocumentoVentaPorCliente,
} from '../src/utils/identificacion.utils';

describe('identificacion.utils', () => {
  describe('esCuitValido (Módulo 11)', () => {
    it('acepta CUITs con dígito verificador correcto', () => {
      expect(esCuitValido('20111111112')).toBe(true);
      expect(esCuitValido('30712345671')).toBe(true);
      expect(esCuitValido('20-11111111-2')).toBe(true); // ignora guiones
    });

    it('rechaza un CUIT con el dígito verificador equivocado', () => {
      expect(esCuitValido('20111111111')).toBe(false);
    });

    it('rechaza cualquier cosa que no tenga 11 dígitos', () => {
      expect(esCuitValido('123')).toBe(false);
      expect(esCuitValido('301234567891')).toBe(false);
    });
  });

  describe('largoValidoParaTipoDocumento', () => {
    it('DNI acepta 7 u 8 dígitos', () => {
      expect(largoValidoParaTipoDocumento('DNI', '1234567')).toBe(true);
      expect(largoValidoParaTipoDocumento('DNI', '12345678')).toBe(true);
      expect(largoValidoParaTipoDocumento('DNI', '123456')).toBe(false);
      expect(largoValidoParaTipoDocumento('DNI', '123456789')).toBe(false);
    });

    it('CUIT sólo acepta 11 dígitos', () => {
      expect(largoValidoParaTipoDocumento('CUIT', '20111111112')).toBe(true);
      expect(largoValidoParaTipoDocumento('CUIT', '12345678')).toBe(false);
    });
  });

  describe('tipoDocumentoVentaPorCliente', () => {
    it('CUIT -> Factura A, DNI -> Factura B', () => {
      expect(tipoDocumentoVentaPorCliente('CUIT')).toBe('FACTURA_A');
      expect(tipoDocumentoVentaPorCliente('DNI')).toBe('FACTURA_B');
    });
  });
});
