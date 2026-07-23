import { calcularNetoEIva, solicitarCaeParaDocumento } from '../../afip/afip.service';
import { encolarContingencia } from '../../afip/cola.repository';
import { docTipoAfip, TIPO_COMPROBANTE_AFIP } from '../../afip/types';
import { env } from '../../config/env';
import { actualizarErrorAfip, actualizarResultadoCae, crearComprobanteAfip } from './comprobantesAfip.repository';
import type { EmisorComprobante, ResultadoEmision } from './emisorComprobante';

/**
 * Emisor Fiscal (Operación FISCAL, AFIP): único punto que habla con el
 * Web Service (WSAA/WSFE) para pedir el CAE. Deja constancia en
 * `comprobantes_afip`. Si AFIP falla, nunca aborta la venta (ver contrato
 * de `solicitarCaeParaDocumento`): el documento queda en CONTINGENCIA y se
 * encola para el worker.
 */
export const emisorFiscalAfip: EmisorComprobante = {
  async emitir(client, ctx) {
    const tipoComprobante = TIPO_COMPROBANTE_AFIP[ctx.tipo_documento];
    const puntoVenta = env.afip.puntoVenta;

    await crearComprobanteAfip(client, {
      id_documento: ctx.id_documento,
      tipo_comprobante: tipoComprobante,
      punto_venta: puntoVenta,
      estado_afip: 'PENDIENTE',
    });

    const { neto, iva } = calcularNetoEIva(ctx.total_neto);
    const resultadoAfip = await solicitarCaeParaDocumento(client, {
      id_documento: ctx.id_documento,
      puntoVenta,
      tipoComprobante,
      docTipo: docTipoAfip(ctx.cliente.tipo_documento),
      docNro: ctx.cliente.numero_documento,
      importeTotal: ctx.total_neto,
      importeNeto: neto,
      importeIva: iva,
      nroComprobanteAfipPrevio: null,
    });

    const fila = resultadoAfip.ok
      ? await actualizarResultadoCae(client, ctx.id_documento, {
          cae: resultadoAfip.cae,
          cae_vencimiento: resultadoAfip.caeVencimiento,
          estado_afip: 'APROBADO',
        })
      : await actualizarErrorAfip(client, ctx.id_documento, {
          estado_afip: resultadoAfip.tipo,
          error_afip_mensaje: resultadoAfip.mensaje,
        });

    if (!resultadoAfip.ok && resultadoAfip.tipo === 'CONTINGENCIA') {
      await encolarContingencia(client, ctx.id_documento);
    }

    const resultado: ResultadoEmision = {
      tipo_comprobante: fila.tipo_comprobante,
      punto_venta: fila.punto_venta,
      nro_comprobante_afip: fila.nro_comprobante_afip,
      cae: fila.cae,
      cae_vencimiento: fila.cae_vencimiento,
      estado_afip: fila.estado_afip,
      error_afip_mensaje: fila.error_afip_mensaje,
      estado_facturacion_interna: null,
    };
    return resultado;
  },
};
