import { describe, expect, it } from 'vitest';
import { AppError } from '../src/utils/AppError';
import { resolverCantidadUnidades } from '../src/utils/documento.utils';

describe('resolverCantidadUnidades', () => {
  it('modo U: devuelve la cantidad tal cual si es entera', () => {
    expect(resolverCantidadUnidades(5, 'U', 2.4, 'SKU1')).toBe(5);
  });

  it('modo U: rechaza una cantidad fraccionaria', () => {
    expect(() => resolverCantidadUnidades(2.5, 'U', 2.4, 'SKU1')).toThrow(AppError);
    try {
      resolverCantidadUnidades(2.5, 'U', 2.4, 'SKU1');
    } catch (err) {
      expect((err as AppError).code).toBe('CANTIDAD_NO_ENTERA');
    }
  });

  it('modo KG: convierte a unidades enteras cuando la equivalencia es exacta', () => {
    expect(resolverCantidadUnidades(4.8, 'KG', 2.4, 'SKU1')).toBe(2);
  });

  it('modo KG: tolera el margen epsilon de punto flotante', () => {
    expect(resolverCantidadUnidades(4.7999999999998, 'KG', 2.4, 'SKU1')).toBe(2);
  });

  it('modo KG: rechaza kilos que no equivalen a una cantidad entera de unidades', () => {
    expect(() => resolverCantidadUnidades(5, 'KG', 2.4, 'SKU1')).toThrow(AppError);
    try {
      resolverCantidadUnidades(5, 'KG', 2.4, 'SKU1');
    } catch (err) {
      expect((err as AppError).code).toBe('CANTIDAD_KG_NO_ENTERA');
      expect((err as AppError).message).toContain('1 U = 2.4kg');
    }
  });

  it('modo KG: rechaza si el producto no tiene peso teórico cargado', () => {
    expect(() => resolverCantidadUnidades(5, 'KG', 0, 'SKU1')).toThrow(AppError);
    try {
      resolverCantidadUnidades(5, 'KG', 0, 'SKU1');
    } catch (err) {
      expect((err as AppError).code).toBe('PESO_TEORICO_NO_CONFIGURADO');
    }
  });
});
