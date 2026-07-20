import type { TipoDocumento, TipoDocumentoCliente } from '../types/domain';

/**
 * Códigos de comprobante AFIP (tabla oficial "Tipos de Comprobante" de
 * WSFEv1). Sólo se listan los que este ERP puede llegar a emitir.
 * NOTA_CREDITO_* queda mapeado para cuando exista el módulo de anulación de
 * comprobantes (no implementado todavía: `TipoDocumento` hoy no distingue
 * notas de crédito) — no se usa activamente aún.
 */
export const TIPO_COMPROBANTE_AFIP: Record<Extract<TipoDocumento, 'FACTURA_A' | 'FACTURA_B'>, number> = {
  FACTURA_A: 1,
  FACTURA_B: 6,
};

export const TIPO_COMPROBANTE_NOTA_CREDITO_AFIP = { A: 3, B: 8 } as const;

/** Remito interno sin validez fiscal, impreso mientras el documento está en CONTINGENCIA. */
export const TIPO_COMPROBANTE_REMITO_INTERNO = 91;

/** DocTipo AFIP: 80 = CUIT, 96 = DNI. */
export function docTipoAfip(tipoDocumentoCliente: TipoDocumentoCliente): 80 | 96 {
  return tipoDocumentoCliente === 'CUIT' ? 80 : 96;
}

export interface TicketAcceso {
  token: string;
  sign: string;
  /** epoch ms; se renueva un poco antes de este momento, no exactamente al vencer. */
  expiraEn: number;
}

export interface DatosComprobanteAfip {
  puntoVenta: number;
  tipoComprobante: number;
  docTipo: 80 | 96;
  docNro: string;
  importeTotal: number;
  /** YYYYMMDD */
  fechaComprobante: string;
}

/** Resultado de negocio de un intento de CAE: nunca se lanza como excepción (ver afip.service.ts). */
export type ResultadoSolicitudCae =
  | {
      ok: true;
      nroComprobanteAfip: number;
      cae: string;
      /** YYYY-MM-DD */
      caeVencimiento: string;
    }
  | {
      ok: false;
      /** CONTINGENCIA: falla técnica (timeout/5xx/sin conexión), reintentable. RECHAZADO: AFIP validó y rechazó, no reintentable sin intervención. */
      tipo: 'CONTINGENCIA' | 'RECHAZADO';
      mensaje: string;
      /** Si ya se había obtenido un número de comprobante antes de la falla, para que el worker pueda consultarlo por idempotencia. */
      nroComprobanteAfip: number | null;
    };
