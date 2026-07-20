import type { UnidadVentaProducto } from '../types/domain';

/**
 * SKUs placeholder del sistema anterior ("NN"/"." y "FF"/".") que aparecen
 * siempre como las dos primeras filas del export de stock y no representan
 * productos reales.
 */
const SKUS_IGNORADOS = new Set(['NN', 'FF']);

/** 'KG' -> KILO, 'UNI' -> UNIDAD (case-insensitive). Cualquier otro valor no se puede interpretar. */
export function mapearUnidadVentaProducto(valor: unknown): UnidadVentaProducto | null {
  const texto = String(valor ?? '').trim().toUpperCase();
  if (texto === 'KG') return 'KILO';
  if (texto === 'UNI') return 'UNIDAD';
  return null;
}

export interface FilaProductoImportado {
  sku: string;
  descripcion: string;
  unidad_venta: UnidadVentaProducto;
}

/**
 * Interpreta una fila cruda del Excel de stock del sistema anterior (sin
 * fila de encabezado: columna A = SKU, B = Descripción, F = Unidad).
 * Devuelve `null` si la fila es basura/placeholder y debe omitirse.
 */
export function interpretarFilaProducto(sku: unknown, descripcion: unknown, unidad: unknown): FilaProductoImportado | null {
  const skuTexto = String(sku ?? '').trim();
  const descripcionTexto = String(descripcion ?? '').trim();
  const unidadVenta = mapearUnidadVentaProducto(unidad);

  if (!skuTexto || SKUS_IGNORADOS.has(skuTexto.toUpperCase())) return null;
  if (!descripcionTexto || descripcionTexto === '.') return null;
  if (!unidadVenta) return null;

  return { sku: skuTexto, descripcion: descripcionTexto, unidad_venta: unidadVenta };
}

export interface FilaProductoCruda {
  sku: unknown;
  descripcion: unknown;
  unidad: unknown;
}

export interface ResultadoProcesamientoProductos {
  /** Deduplicados por SKU: si un SKU se repite, gana la última aparición en el archivo. */
  productos: FilaProductoImportado[];
  filasOmitidas: number;
  skusDuplicados: string[];
}

/** Pipeline completo (sin I/O) para poder testearlo sin depender de exceljs ni de la base. */
export function procesarFilasProductos(filas: FilaProductoCruda[]): ResultadoProcesamientoProductos {
  const porSku = new Map<string, FilaProductoImportado>();
  const duplicados = new Set<string>();
  let filasOmitidas = 0;

  for (const fila of filas) {
    const interpretada = interpretarFilaProducto(fila.sku, fila.descripcion, fila.unidad);
    if (!interpretada) {
      filasOmitidas++;
      continue;
    }
    if (porSku.has(interpretada.sku)) {
      duplicados.add(interpretada.sku);
    }
    porSku.set(interpretada.sku, interpretada);
  }

  return { productos: [...porSku.values()], filasOmitidas, skusDuplicados: [...duplicados] };
}
