import { readFileSync } from 'node:fs';
import forge from 'node-forge';
import { env } from '../config/env';
import { construirSobreLoginCms, construirTra, parsearRespuestaLoginCms } from './xml.utils';
import type { TicketAcceso } from './types';

/**
 * Ticket cacheado en memoria del proceso (válido ~12hs, WSAA lo emite con
 * `expirationTime`). Un solo servicio ("wsfe") consumido por este ERP, así
 * que alcanza con una variable de módulo; si el backend corriera en más de
 * una instancia convendría moverlo a Redis para no pedir un ticket nuevo por
 * instancia, pero no es necesario con un único proceso Node.
 */
let ticketCacheado: TicketAcceso | null = null;

/** Margen de seguridad antes de la expiración real para renovar el ticket. */
const MARGEN_RENOVACION_MS = 5 * 60 * 1000;

function certificadosConfigurados(): boolean {
  return env.afip.cuit !== '' && env.afip.certPath !== '' && env.afip.keyPath !== '';
}

/**
 * Firma el TRA como CMS/PKCS#7 (detached, DER, base64) con el certificado y
 * clave privada del contribuyente, tal como exige WSAA `loginCms`.
 */
function firmarTra(traXml: string): string {
  const certPem = readFileSync(env.afip.certPath, 'utf-8');
  const keyPem = readFileSync(env.afip.keyPath, 'utf-8');

  const cert = forge.pki.certificateFromPem(certPem);
  const privateKey = forge.pki.privateKeyFromPem(keyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(traXml, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      // Sin `value`: forge completa la hora de firma actual automáticamente (ver pkcs7.js).
      { type: forge.pki.oids.signingTime },
    ],
  });
  p7.sign({ detached: false });

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

async function pedirTicketAWsaa(): Promise<TicketAcceso> {
  const traXml = construirTra('wsfe');
  const cmsBase64 = firmarTra(traXml);
  const sobre = construirSobreLoginCms(cmsBase64);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.afip.timeoutMs);
  try {
    const respuesta = await fetch(env.afip.wsaaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
      body: sobre,
      signal: controller.signal,
    });
    const textoRespuesta = await respuesta.text();
    if (!respuesta.ok) {
      throw new Error(`WSAA respondió ${respuesta.status}: ${textoRespuesta.slice(0, 300)}`);
    }
    const { token, sign, expirationTime } = parsearRespuestaLoginCms(textoRespuesta);
    return { token, sign, expiraEn: new Date(expirationTime).getTime() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Devuelve un ticket de acceso válido, sirviendo desde la cache de memoria
 * cuando todavía no está por vencer. Lanza si no hay certificado configurado
 * o si WSAA no responde — quien llama (`afip.service.ts`) es responsable de
 * capturarlo y convertirlo en contingencia, nunca debe propagarse hasta
 * romper la venta.
 */
export async function obtenerTicketAcceso(): Promise<TicketAcceso> {
  if (!certificadosConfigurados()) {
    throw new Error(
      'AFIP no está configurado (faltan AFIP_CUIT / AFIP_CERT_PATH / AFIP_KEY_PATH): no se puede autenticar contra WSAA.',
    );
  }
  if (ticketCacheado && ticketCacheado.expiraEn - MARGEN_RENOVACION_MS > Date.now()) {
    return ticketCacheado;
  }
  ticketCacheado = await pedirTicketAWsaa();
  return ticketCacheado;
}

/** Sólo para tests: fuerza el estado de la cache del ticket. */
export function _resetTicketCacheParaTests(ticket: TicketAcceso | null = null): void {
  ticketCacheado = ticket;
}
