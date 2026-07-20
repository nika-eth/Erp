import { env } from '../config/env';
import {
  construirSobreConsultar,
  construirSobreFecaeSolicitar,
  construirSobreUltimoAutorizado,
  parsearRespuestaFecae,
  parsearUltimoAutorizado,
  type DetalleFecaeRequest,
  type ResultadoFecaeParseado,
} from './xml.utils';

export interface AuthWsfe {
  token: string;
  sign: string;
  cuit: string;
}

async function postSoap(sobre: string, soapAction: string, signal: AbortSignal): Promise<string> {
  const respuesta = await fetch(env.afip.wsfeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: soapAction },
    body: sobre,
    signal,
  });
  const texto = await respuesta.text();
  if (!respuesta.ok) {
    throw new Error(`WSFE respondió ${respuesta.status} en ${soapAction}: ${texto.slice(0, 300)}`);
  }
  return texto;
}

/** Último número de comprobante autorizado por AFIP para (puntoVenta, tipoComprobante). El próximo a pedir es éste + 1. */
export async function consultarUltimoAutorizado(
  auth: AuthWsfe,
  ptoVta: number,
  cbteTipo: number,
  signal: AbortSignal,
): Promise<number> {
  const sobre = construirSobreUltimoAutorizado(auth, ptoVta, cbteTipo);
  const xml = await postSoap(sobre, 'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado', signal);
  return parsearUltimoAutorizado(xml);
}

/** `FECAESolicitar`: pide el CAE para un único comprobante (WSFEv1 no admite el detalle ítem por ítem, sólo importes agregados). */
export async function solicitarCae(
  auth: AuthWsfe,
  ptoVta: number,
  cbteTipo: number,
  detalle: DetalleFecaeRequest,
  signal: AbortSignal,
): Promise<ResultadoFecaeParseado> {
  const sobre = construirSobreFecaeSolicitar(auth, ptoVta, cbteTipo, detalle);
  const xml = await postSoap(sobre, 'http://ar.gov.afip.dif.FEV1/FECAESolicitar', signal);
  return parsearRespuestaFecae(xml);
}

/** `FECompConsultar`: usado por el worker de contingencia para chequear, antes de reintentar, si AFIP ya había procesado el comprobante. */
export async function consultarComprobante(
  auth: AuthWsfe,
  ptoVta: number,
  cbteTipo: number,
  cbteNro: number,
  signal: AbortSignal,
): Promise<ResultadoFecaeParseado> {
  const sobre = construirSobreConsultar(auth, ptoVta, cbteTipo, cbteNro);
  const xml = await postSoap(sobre, 'http://ar.gov.afip.dif.FEV1/FECompConsultar', signal);
  return parsearRespuestaFecae(xml);
}
