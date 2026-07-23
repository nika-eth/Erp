import { crearComprobanteInterno } from './comprobantesInternos.repository';
import type { EmisorComprobante, ResultadoEmision } from './emisorComprobante';

/**
 * Emisor de Comprobante Interno (Operación INTERNA, Remito X): deja
 * constancia en `comprobantes_internos` y nada más. CERO imports de
 * `src/afip/**` — es el firewall lógico pedido, verificado además en CI por
 * `dependency-cruiser` (`.dependency-cruiser.cjs`) para que no dependa de
 * la disciplina de quien edite este archivo en el futuro.
 */
export const emisorInterno: EmisorComprobante = {
  async emitir(client, ctx) {
    const fila = await crearComprobanteInterno(client, { id_documento: ctx.id_documento, nro_remito: ctx.nro_remito });
    const resultado: ResultadoEmision = {
      tipo_comprobante: null,
      punto_venta: null,
      nro_comprobante_afip: null,
      cae: null,
      cae_vencimiento: null,
      estado_afip: null,
      error_afip_mensaje: null,
      estado_facturacion_interna: fila.estado_facturacion_interna,
    };
    return resultado;
  },
};
