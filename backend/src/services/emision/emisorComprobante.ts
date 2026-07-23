import type { PoolClient } from 'pg';
import type { Cliente, EstadoAfip, EstadoFacturacionInterna, TipoDocumento } from '../../types/domain';

/** Datos que necesita cualquier emisor para resolver el comprobante de una venta ya insertada en `documentos`. */
export interface ContextoEmision {
  id_documento: number;
  nro_remito: number | null;
  /** 'PRESUPUESTO' nunca llega acá: `guardarPresupuesto` no emite comprobante. */
  tipo_documento: Extract<TipoDocumento, 'FACTURA_A' | 'FACTURA_B'>;
  total_neto: number;
  cliente: Pick<Cliente, 'tipo_documento' | 'numero_documento'>;
}

/**
 * Forma plana de vuelta: se fusiona tal cual (`{ ...documento, ...resultado }`)
 * sobre el `Documento` en memoria, así los consumidores existentes (historial,
 * `Comprobante.tsx`, `EstadoFiscalBadge.tsx` en el frontend) no ven ningún
 * cambio de forma pese a que el dato ahora vive en una tabla satélite.
 */
export interface ResultadoEmision {
  tipo_comprobante: number | null;
  punto_venta: number | null;
  nro_comprobante_afip: number | null;
  cae: string | null;
  cae_vencimiento: string | null;
  estado_afip: EstadoAfip | null;
  error_afip_mensaje: string | null;
  estado_facturacion_interna: EstadoFacturacionInterna | null;
}

/**
 * Strategy de emisión de comprobante. Cada implementación es responsable de
 * insertar su propia fila satélite (`comprobantes_afip` o
 * `comprobantes_internos`) y devolver el resultado en la forma plana de
 * `ResultadoEmision`. `emisorInterno.ts` NO PUEDE importar nada bajo
 * `src/afip/` — lo verifica `dependency-cruiser` en CI (ver
 * `.dependency-cruiser.cjs`), no sólo la convención de nombres.
 */
export interface EmisorComprobante {
  emitir(client: PoolClient, ctx: ContextoEmision): Promise<ResultadoEmision>;
}
