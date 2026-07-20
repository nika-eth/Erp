import { describe, expect, it } from 'vitest';
import {
  interpretarFilaProducto,
  mapearUnidadVentaProducto,
  procesarFilasProductos,
} from '../src/utils/productos.utils';

describe('productos.utils', () => {
  describe('mapearUnidadVentaProducto', () => {
    it('mapea KG -> KILO y UNI -> UNIDAD, sin importar mayúsculas/espacios', () => {
      expect(mapearUnidadVentaProducto('KG')).toBe('KILO');
      expect(mapearUnidadVentaProducto(' uni ')).toBe('UNIDAD');
    });

    it('devuelve null ante un valor no interpretable', () => {
      expect(mapearUnidadVentaProducto('LT')).toBeNull();
      expect(mapearUnidadVentaProducto(null)).toBeNull();
      expect(mapearUnidadVentaProducto(undefined)).toBeNull();
    });
  });

  describe('interpretarFilaProducto', () => {
    it('interpreta una fila válida', () => {
      expect(interpretarFilaProducto('HRA-12', 'Hierro Redondo Aletado 12mm', 'UNI')).toEqual({
        sku: 'HRA-12',
        descripcion: 'Hierro Redondo Aletado 12mm',
        unidad_venta: 'UNIDAD',
      });
    });

    it('omite las filas placeholder del sistema anterior (NN/FF con descripción ".")', () => {
      expect(interpretarFilaProducto('NN', '.', 'UNI')).toBeNull();
      expect(interpretarFilaProducto('FF', '.', 'KG')).toBeNull();
    });

    it('omite filas sin SKU, sin descripción o con unidad no interpretable', () => {
      expect(interpretarFilaProducto('', 'Algo', 'UNI')).toBeNull();
      expect(interpretarFilaProducto('SKU1', '', 'UNI')).toBeNull();
      expect(interpretarFilaProducto('SKU1', 'Algo', 'LT')).toBeNull();
      expect(interpretarFilaProducto(null, 0, 0)).toBeNull();
    });
  });

  describe('procesarFilasProductos', () => {
    it('deduplica por SKU quedándose con la última aparición', () => {
      const resultado = procesarFilasProductos([
        { sku: 'ÑR116', descripcion: 'Producto viejo', unidad: 'UNI' },
        { sku: 'ÑR116', descripcion: 'Producto actualizado', unidad: 'KG' },
      ]);
      expect(resultado.productos).toEqual([{ sku: 'ÑR116', descripcion: 'Producto actualizado', unidad_venta: 'KILO' }]);
      expect(resultado.skusDuplicados).toEqual(['ÑR116']);
    });

    it('cuenta las filas omitidas sin frenar el procesamiento del resto', () => {
      const resultado = procesarFilasProductos([
        { sku: 'NN', descripcion: '.', unidad: 'UNI' },
        { sku: 'HRA-12', descripcion: 'Hierro Redondo Aletado 12mm', unidad: 'UNI' },
        { sku: '', descripcion: 'Sin sku', unidad: 'UNI' },
      ]);
      expect(resultado.productos).toHaveLength(1);
      expect(resultado.filasOmitidas).toBe(2);
    });
  });
});
