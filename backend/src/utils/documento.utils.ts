import { AppError } from './AppError';
import type { TipoDocumento, UnidadIngresoCantidad } from '../types/domain';

/** Redondea a 2 decimales evitando errores de coma flotante en montos. */
export function redondearMoneda(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/**
 * Margen de tolerancia para la equivalencia kilos -> unidades enteras:
 * evita que un error de redondeo de punto flotante (ej. `4.80 / 2.40` dando
 * `1.9999999999998`) rechace una cantidad que en la práctica es exacta.
 */
const EPSILON_UNIDADES = 0.01;

/**
 * Los materiales se venden en unidades físicas enteras (sin fraccionamiento
 * ni retazos), pero el vendedor puede cargar la cantidad en el mostrador
 * como conteo de unidades ('U') o en kilos ('KG'). Esta función es la única
 * fuente de verdad de esa conversión — la usan tanto `ventas.service.ts`
 * (`calcularItems`) como `remitos.service.ts` (`generarRemito`) para no
 * duplicar la tolerancia de punto flotante. Nunca confía en un valor ya
 * resuelto por el cliente: siempre recalcula server-side.
 */
export function resolverCantidadUnidades(
  cantidadIngresada: number,
  unidadIngreso: UnidadIngresoCantidad,
  pesoTeoricoKg: number,
  sku: string,
): number {
  if (unidadIngreso === 'U') {
    if (!Number.isInteger(cantidadIngresada)) {
      throw AppError.badRequest(
        'CANTIDAD_NO_ENTERA',
        `La cantidad de unidades para ${sku} debe ser un número entero (no se venden fracciones/retazos).`,
      );
    }
    return cantidadIngresada;
  }

  if (pesoTeoricoKg <= 0) {
    throw AppError.badRequest(
      'PESO_TEORICO_NO_CONFIGURADO',
      `El producto ${sku} no tiene peso teórico cargado; no se puede vender por kilos (cargalo en Gestión de Productos, F7).`,
    );
  }

  const unidadesCalculadas = cantidadIngresada / pesoTeoricoKg;
  const unidadesEnteras = Math.round(unidadesCalculadas);
  const diferencia = Math.abs(unidadesCalculadas - unidadesEnteras);

  if (diferencia > EPSILON_UNIDADES || unidadesEnteras <= 0) {
    throw AppError.badRequest(
      'CANTIDAD_KG_NO_ENTERA',
      `${cantidadIngresada}kg de ${sku} no equivale a una cantidad entera de unidades (1 U = ${pesoTeoricoKg}kg).`,
    );
  }

  return unidadesEnteras;
}

/** Etiqueta legible para mostrar en conceptos de cuenta_corriente y UI. */
export const ETIQUETA_TIPO_DOCUMENTO: Record<TipoDocumento, string> = {
  FACTURA_A: 'Factura A',
  FACTURA_B: 'Factura B',
  PRESUPUESTO: 'Presupuesto',
};

/**
 * Columnas propias de `documentos` (sin `items`: ahora vive en
 * `documentos_detalles`, ver `sql/009_documentos_detalles.sql`; sin los
 * metadatos de comprobante fiscal/interno: viven en tablas satélite, ver
 * `joinComprobantes` más abajo). Sirve tal cual en `INSERT/UPDATE ...
 * RETURNING` sin alias — un `INSERT/UPDATE` nunca puede `RETURNING` columnas
 * de otra tabla, por eso el resultado de emitir el comprobante (CAE, estado,
 * etc.) se fusiona en JS después de llamar al `EmisorComprobante` que
 * corresponda (ver `services/emision/`), no viaja en este mismo `RETURNING`.
 */
export const DOCUMENTO_COLUMNAS_BASE = `
  id_documento, id_sucursal_origen, nro_remito, fecha, cliente_id, total_neto, tipo_documento, id_zona,
  es_fiscal, id_documento_origen_ci, estado_despacho
`;

/**
 * Igual que `DOCUMENTO_COLUMNAS_BASE`, pero con cada columna calificada por
 * `alias` — imprescindible en un SELECT que además haga JOIN con
 * `comprobantes_afip`/`comprobantes_internos` (ver `joinComprobantes`): esas
 * dos satélite también tienen `id_documento`, así que sin calificar el
 * nombre queda ambiguo para Postgres (`column reference "id_documento" is
 * ambiguous`). En un `INSERT/UPDATE ... RETURNING` (sin JOIN posible) no
 * hace falta esto — ahí se usa `DOCUMENTO_COLUMNAS_BASE` tal cual.
 */
export function documentoColumnasBase(alias: string): string {
  return `
    ${alias}.id_documento, ${alias}.id_sucursal_origen, ${alias}.nro_remito, ${alias}.fecha, ${alias}.cliente_id,
    ${alias}.total_neto, ${alias}.tipo_documento, ${alias}.id_zona, ${alias}.es_fiscal, ${alias}.id_documento_origen_ci,
    ${alias}.estado_despacho
  `;
}

/**
 * Fragmento de columnas + JOIN para incorporar los metadatos de comprobante
 * (fiscal o interno) a un SELECT sobre `documentos` — sólo lecturas, nunca
 * `RETURNING` de un INSERT/UPDATE (ver comentario de `DOCUMENTO_COLUMNAS_BASE`).
 * `alias` es el alias de `documentos` en el `FROM` (ej. `d`). Un documento
 * sólo tiene fila en UNA de las dos satélite (según `es_fiscal`), por eso el
 * `LEFT JOIN`: la que no aplica siempre sale `NULL`, igual que las columnas
 * nullable que existían antes en `documentos`.
 */
export function joinComprobantes(alias: string): { columnas: string; join: string } {
  return {
    columnas: `
      ca.tipo_comprobante, ca.punto_venta, ca.nro_comprobante_afip, ca.cae, ca.cae_vencimiento,
      ca.estado_afip, ca.error_afip_mensaje,
      ci.estado_facturacion_interna
    `,
    join: `
      LEFT JOIN comprobantes_afip ca ON ca.id_documento = ${alias}.id_documento
      LEFT JOIN comprobantes_internos ci ON ci.id_documento = ${alias}.id_documento
    `,
  };
}

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
