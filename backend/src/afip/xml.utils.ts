/**
 * Helpers de XML/SOAP minimalistas, a mano (sin librería de parsing XML) —
 * mismo criterio "sin ORM" que el resto del backend: los mensajes que
 * intercambiamos con AFIP (WSAA/WSFEv1) tienen una forma fija y conocida, y
 * extraer un puñado de tags puntuales con regex es más simple y más fácil de
 * testear sin red que integrar un parser XML completo.
 */

/** Extrae el contenido de texto del primer `<tag>...</tag>` (sin atributos en la búsqueda). */
export function extraerTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1].trim() : null;
}

/** Revierte el escapado XML de entidades (usado porque `loginCmsReturn` viaja como XML-dentro-de-XML). */
export function desescaparXml(valor: string): string {
  return valor
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Arma el Ticket de Requerimiento de Acceso (TRA) que se firma para pedir token/sign a WSAA. */
export function construirTra(service: string, ahora: Date = new Date()): string {
  const uniqueId = Math.floor(ahora.getTime() / 1000);
  const generationTime = new Date(ahora.getTime() - 10 * 60 * 1000).toISOString();
  const expirationTime = new Date(ahora.getTime() + 10 * 60 * 1000).toISOString();

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header>` +
    `<uniqueId>${uniqueId}</uniqueId>` +
    `<generationTime>${generationTime}</generationTime>` +
    `<expirationTime>${expirationTime}</expirationTime>` +
    `</header>` +
    `<service>${service}</service>` +
    `</loginTicketRequest>`
  );
}

export function construirSobreLoginCms(cmsBase64: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Header/>` +
    `<soapenv:Body><wsaa:loginCms><wsaa:in0>${cmsBase64}</wsaa:in0></wsaa:loginCms></soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

export interface TicketParseado {
  token: string;
  sign: string;
  expirationTime: string;
}

/** Parsea la respuesta de `loginCms`: el ticket viaja como XML escapado dentro de `<loginCmsReturn>`. */
export function parsearRespuestaLoginCms(soapXml: string): TicketParseado {
  const loginCmsReturn = extraerTag(soapXml, 'loginCmsReturn');
  if (!loginCmsReturn) {
    throw new Error('Respuesta de WSAA sin loginCmsReturn: ' + soapXml.slice(0, 500));
  }
  const ticketXml = desescaparXml(loginCmsReturn);
  const token = extraerTag(ticketXml, 'token');
  const sign = extraerTag(ticketXml, 'sign');
  const expirationTime = extraerTag(ticketXml, 'expirationTime');
  if (!token || !sign || !expirationTime) {
    throw new Error('Ticket de WSAA incompleto (falta token/sign/expirationTime).');
  }
  return { token, sign, expirationTime };
}

function construirHeaderAuth(auth: { token: string; sign: string; cuit: string }): string {
  return `<ar:Auth><ar:Token>${auth.token}</ar:Token><ar:Sign>${auth.sign}</ar:Sign><ar:Cuit>${auth.cuit}</ar:Cuit></ar:Auth>`;
}

export function construirSobreUltimoAutorizado(
  auth: { token: string; sign: string; cuit: string },
  ptoVta: number,
  cbteTipo: number,
): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">` +
    `<soapenv:Header/>` +
    `<soapenv:Body><ar:FECompUltimoAutorizado>` +
    `${construirHeaderAuth(auth)}` +
    `<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo>` +
    `</ar:FECompUltimoAutorizado></soapenv:Body></soapenv:Envelope>`
  );
}

export function parsearUltimoAutorizado(soapXml: string): number {
  const nro = extraerTag(soapXml, 'CbteNro');
  if (nro === null) {
    throw new Error('Respuesta de FECompUltimoAutorizado sin CbteNro: ' + soapXml.slice(0, 500));
  }
  return Number(nro);
}

export interface DetalleFecaeRequest {
  concepto: number;
  docTipo: number;
  docNro: string;
  cbteNro: number;
  cbteFch: string;
  impTotal: number;
  impNeto: number;
  impIva: number;
}

export function construirSobreFecaeSolicitar(
  auth: { token: string; sign: string; cuit: string },
  ptoVta: number,
  cbteTipo: number,
  det: DetalleFecaeRequest,
): string {
  const importe2 = (n: number) => n.toFixed(2);
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">` +
    `<soapenv:Header/>` +
    `<soapenv:Body><ar:FECAESolicitar>${construirHeaderAuth(auth)}` +
    `<ar:FeCAEReq>` +
    `<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo></ar:FeCabReq>` +
    `<ar:FeDetReq><ar:FECAEDetRequest>` +
    `<ar:Concepto>${det.concepto}</ar:Concepto>` +
    `<ar:DocTipo>${det.docTipo}</ar:DocTipo>` +
    `<ar:DocNro>${det.docNro}</ar:DocNro>` +
    `<ar:CbteDesde>${det.cbteNro}</ar:CbteDesde>` +
    `<ar:CbteHasta>${det.cbteNro}</ar:CbteHasta>` +
    `<ar:CbteFch>${det.cbteFch}</ar:CbteFch>` +
    `<ar:ImpTotal>${importe2(det.impTotal)}</ar:ImpTotal>` +
    `<ar:ImpTotConc>0.00</ar:ImpTotConc>` +
    `<ar:ImpNeto>${importe2(det.impNeto)}</ar:ImpNeto>` +
    `<ar:ImpOpEx>0.00</ar:ImpOpEx>` +
    `<ar:ImpIVA>${importe2(det.impIva)}</ar:ImpIVA>` +
    `<ar:ImpTrib>0.00</ar:ImpTrib>` +
    `<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>` +
    `<ar:Iva><ar:AlicIva><ar:Id>5</ar:Id><ar:BaseImp>${importe2(det.impNeto)}</ar:BaseImp><ar:Importe>${importe2(det.impIva)}</ar:Importe></ar:AlicIva></ar:Iva>` +
    `</ar:FECAEDetRequest></ar:FeDetReq>` +
    `</ar:FeCAEReq></ar:FECAESolicitar></soapenv:Body></soapenv:Envelope>`
  );
}

export interface ResultadoFecaeParseado {
  resultado: 'A' | 'R' | null;
  cae: string | null;
  /** YYYYMMDD tal como lo devuelve AFIP, sin normalizar. */
  caeFchVto: string | null;
  observaciones: string | null;
  errores: string | null;
}

/** Interpreta la respuesta de `FECAESolicitar` (o de `FECompConsultar`, misma forma de detalle). */
export function parsearRespuestaFecae(soapXml: string): ResultadoFecaeParseado {
  const resultadoRaw = extraerTag(soapXml, 'Resultado');
  const resultado = resultadoRaw === 'A' || resultadoRaw === 'R' ? resultadoRaw : null;
  const cae = extraerTag(soapXml, 'CAE');
  const caeFchVto = extraerTag(soapXml, 'CAEFchVto');

  const obsMatches = [...soapXml.matchAll(/<Msg>([\s\S]*?)<\/Msg>/g)].map((m) => m[1].trim());
  const errMatches = [...soapXml.matchAll(/<Err>[\s\S]*?<Msg>([\s\S]*?)<\/Msg>[\s\S]*?<\/Err>/g)].map((m) =>
    m[1].trim(),
  );

  return {
    resultado,
    cae,
    caeFchVto,
    observaciones: obsMatches.length > 0 ? obsMatches.join(' | ') : null,
    errores: errMatches.length > 0 ? errMatches.join(' | ') : null,
  };
}

export function construirSobreConsultar(
  auth: { token: string; sign: string; cuit: string },
  ptoVta: number,
  cbteTipo: number,
  cbteNro: number,
): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">` +
    `<soapenv:Header/>` +
    `<soapenv:Body><ar:FECompConsultar>${construirHeaderAuth(auth)}` +
    `<ar:FeCompConsReq><ar:CbteTipo>${cbteTipo}</ar:CbteTipo><ar:CbteNro>${cbteNro}</ar:CbteNro><ar:PtoVta>${ptoVta}</ar:PtoVta></ar:FeCompConsReq>` +
    `</ar:FECompConsultar></soapenv:Body></soapenv:Envelope>`
  );
}

/** 'YYYY-MM-DD' -> 'YYYYMMDD' (formato de fecha que exige WSFEv1). */
export function fechaAfip(fecha: Date = new Date()): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** 'YYYYMMDD' (AFIP) -> 'YYYY-MM-DD' (columna DATE de Postgres). */
export function normalizarFechaAfip(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}
