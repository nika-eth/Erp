import type { PoolClient } from 'pg';
import { env } from '../config/env';
import { fechaAfip, normalizarFechaAfip } from './xml.utils';
import { obtenerTicketAcceso } from './wsaa.service';
import { consultarComprobante, consultarUltimoAutorizado, solicitarCae as solicitarCaeWsfe } from './wsfe.service';
import type { ResultadoSolicitudCae } from './types';

export interface ParametrosSolicitudCae {
  id_documento: number;
  puntoVenta: number;
  tipoComprobante: number;
  docTipo: 80 | 96;
  docNro: string;
  importeTotal: number;
  /** Alícuota única 21%: neto = total / 1.21. Ver ADVERTENCIA en el comentario de más abajo. */
  importeNeto: number;
  importeIva: number;
  /** Si un intento previo (contingencia) ya había reservado un número AFIP, se reutiliza en vez de pedir uno nuevo. */
  nroComprobanteAfipPrevio: number | null;
}

/**
 * ADVERTENCIA de negocio: el modelo de datos actual (`documentos.total_neto`
 * / `items[].subtotal`) no discrimina IVA — los precios cargados en Carga
 * Unificada se asumen IVA incluido (21%), que es la práctica habitual de
 * mostrador. `calcularNetoEIva` deriva el neto y el IVA desde ese total para
 * poder informarlos a AFIP (que sí los exige discriminados). Si en algún
 * momento se empieza a cargar el precio neto explícitamente, este cálculo
 * hay que reemplazarlo por los valores reales en lugar de derivarlos.
 */
export function calcularNetoEIva(importeTotal: number): { neto: number; iva: number } {
  const neto = Math.round((importeTotal / 1.21) * 100) / 100;
  const iva = Math.round((importeTotal - neto) * 100) / 100;
  return { neto, iva };
}

/**
 * Orquesta la solicitud de CAE para un comprobante: ticket WSAA (cacheado),
 * lock de numeración (serializa contra otras facturaciones concurrentes al
 * mismo punto de venta + tipo de comprobante) y las llamadas WSFEv1.
 *
 * Contrato deliberado: esta función NUNCA lanza. Cualquier falla (AFIP no
 * configurado, WSAA caído, timeout, red, respuesta inesperada) se captura acá
 * adentro y se devuelve como `{ ok: false, tipo: 'CONTINGENCIA', ... }` —
 * porque la regla de negocio es que un problema de AFIP jamás debe volcar
 * la transacción de venta. Sólo un rechazo explícito y validado por AFIP
 * (`Resultado = 'R'`) se devuelve como `RECHAZADO`, que tampoco lanza: sigue
 * siendo responsabilidad del caller decidir qué hacer, nunca de abortar la
 * venta.
 *
 * `client` es el mismo `PoolClient` de la transacción de venta (o, cuando la
 * llama el worker de contingencia, el de su propia transacción corta): se
 * usa para el advisory lock de numeración y para persistir
 * `nro_comprobante_afip` en cuanto se obtiene de AFIP, ANTES de pedir el CAE
 * — así, si el pedido de CAE se cae justo después, un reintento posterior
 * sabe por qué número puntual preguntarle a AFIP (`FECompConsultar`) en vez
 * de arriesgarse a pedir uno nuevo y duplicar la numeración fiscal.
 */
export async function solicitarCaeParaDocumento(
  client: PoolClient,
  params: ParametrosSolicitudCae,
): Promise<ResultadoSolicitudCae> {
  let nroComprobante = params.nroComprobanteAfipPrevio;

  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `afip:${params.puntoVenta}:${params.tipoComprobante}`,
    ]);

    const ticket = await obtenerTicketAcceso();
    const auth = { token: ticket.token, sign: ticket.sign, cuit: env.afip.cuit };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.afip.timeoutMs);

    try {
      if (nroComprobante === null) {
        const ultimo = await consultarUltimoAutorizado(auth, params.puntoVenta, params.tipoComprobante, controller.signal);
        nroComprobante = ultimo + 1;
        await client.query(`UPDATE comprobantes_afip SET nro_comprobante_afip = $1 WHERE id_documento = $2`, [
          nroComprobante,
          params.id_documento,
        ]);
      }

      const resultado = await solicitarCaeWsfe(
        auth,
        params.puntoVenta,
        params.tipoComprobante,
        {
          concepto: 1,
          docTipo: params.docTipo,
          docNro: params.docNro,
          cbteNro: nroComprobante,
          cbteFch: fechaAfip(),
          impTotal: params.importeTotal,
          impNeto: params.importeNeto,
          impIva: params.importeIva,
        },
        controller.signal,
      );

      if (resultado.resultado === 'A' && resultado.cae && resultado.caeFchVto) {
        return {
          ok: true,
          nroComprobanteAfip: nroComprobante,
          cae: resultado.cae,
          caeVencimiento: normalizarFechaAfip(resultado.caeFchVto),
        };
      }

      if (resultado.resultado === 'R') {
        return {
          ok: false,
          tipo: 'RECHAZADO',
          mensaje: resultado.observaciones ?? resultado.errores ?? 'AFIP rechazó el comprobante sin detalle.',
          nroComprobanteAfip: nroComprobante,
        };
      }

      // Respuesta sin `Resultado` interpretable (ej. sólo `Errors`, forma
      // inesperada): se trata como falla técnica, no como rechazo de
      // negocio, porque no hay certeza de que AFIP haya evaluado el
      // comprobante.
      return {
        ok: false,
        tipo: 'CONTINGENCIA',
        mensaje: resultado.errores ?? 'Respuesta de AFIP no interpretable.',
        nroComprobanteAfip: nroComprobante,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return {
      ok: false,
      tipo: 'CONTINGENCIA',
      mensaje: err instanceof Error ? err.message : 'Error desconocido al contactar a AFIP.',
      nroComprobanteAfip: nroComprobante,
    };
  }
}

export type ResultadoConsultaPrevia =
  | { estado: 'PROCESADO'; resultado: ResultadoSolicitudCae }
  /** AFIP no tiene registro de este comprobante: el intento anterior nunca llegó a procesarse; es seguro pedir un número nuevo. */
  | { estado: 'NO_ENCONTRADO' }
  /** No se pudo confirmar nada (AFIP sigue caído, timeout de nuevo, etc.): no es seguro reintentar todavía. */
  | { estado: 'ERROR'; mensaje: string };

/**
 * Usado por el worker de contingencia: antes de reintentar `FECAESolicitar`
 * para un comprobante que ya tiene `nro_comprobante_afip` asignado, chequea
 * si AFIP ya lo había procesado en el intento anterior que dio timeout
 * (idempotencia). Igual que `solicitarCaeParaDocumento`, nunca lanza.
 */
export async function consultarSiYaFueProcesado(
  ptoVta: number,
  cbteTipo: number,
  cbteNro: number,
): Promise<ResultadoConsultaPrevia> {
  try {
    const ticket = await obtenerTicketAcceso();
    const auth = { token: ticket.token, sign: ticket.sign, cuit: env.afip.cuit };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.afip.timeoutMs);
    try {
      const resultado = await consultarComprobante(auth, ptoVta, cbteTipo, cbteNro, controller.signal);
      if (resultado.resultado === 'A' && resultado.cae && resultado.caeFchVto) {
        return {
          estado: 'PROCESADO',
          resultado: {
            ok: true,
            nroComprobanteAfip: cbteNro,
            cae: resultado.cae,
            caeVencimiento: normalizarFechaAfip(resultado.caeFchVto),
          },
        };
      }
      if (resultado.resultado === 'R') {
        return {
          estado: 'PROCESADO',
          resultado: {
            ok: false,
            tipo: 'RECHAZADO',
            mensaje: resultado.observaciones ?? resultado.errores ?? 'AFIP rechazó el comprobante sin detalle.',
            nroComprobanteAfip: cbteNro,
          },
        };
      }
      return { estado: 'NO_ENCONTRADO' };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { estado: 'ERROR', mensaje: err instanceof Error ? err.message : 'Error desconocido al consultar AFIP.' };
  }
}
