import { describe, expect, it } from 'vitest';
import {
  construirSobreFecaeSolicitar,
  construirTra,
  desescaparXml,
  extraerTag,
  fechaAfip,
  normalizarFechaAfip,
  parsearRespuestaFecae,
  parsearRespuestaLoginCms,
  parsearUltimoAutorizado,
} from '../src/afip/xml.utils';

describe('afip/xml.utils', () => {
  it('extraerTag encuentra el contenido de un tag simple', () => {
    expect(extraerTag('<a><b>hola</b></a>', 'b')).toBe('hola');
    expect(extraerTag('<a><b></b></a>', 'c')).toBeNull();
  });

  it('desescaparXml revierte las entidades XML estándar', () => {
    expect(desescaparXml('&lt;token&gt;abc&lt;/token&gt;')).toBe('<token>abc</token>');
  });

  it('construirTra arma un TRA válido con el servicio pedido', () => {
    const xml = construirTra('wsfe', new Date('2026-07-20T12:00:00Z'));
    expect(xml).toContain('<service>wsfe</service>');
    expect(xml).toContain('<uniqueId>');
    expect(extraerTag(xml, 'generationTime')).toBe('2026-07-20T11:50:00.000Z');
    expect(extraerTag(xml, 'expirationTime')).toBe('2026-07-20T12:10:00.000Z');
  });

  it('parsearRespuestaLoginCms extrae token/sign/expirationTime del XML escapado anidado', () => {
    const ticketXml =
      '<loginTicketResponse><credentials><token>TKN123</token><sign>SGN456</sign></credentials>' +
      '<header><expirationTime>2026-07-20T23:59:00Z</expirationTime></header></loginTicketResponse>';
    const escapado = ticketXml.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const soap = `<soapenv:Envelope><soapenv:Body><loginCmsResponse><loginCmsReturn>${escapado}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`;

    const ticket = parsearRespuestaLoginCms(soap);
    expect(ticket).toEqual({ token: 'TKN123', sign: 'SGN456', expirationTime: '2026-07-20T23:59:00Z' });
  });

  it('parsearRespuestaLoginCms lanza si falta loginCmsReturn', () => {
    expect(() => parsearRespuestaLoginCms('<soapenv:Envelope></soapenv:Envelope>')).toThrow();
  });

  it('parsearUltimoAutorizado extrae el CbteNro', () => {
    const xml = '<FECompUltimoAutorizadoResult><CbteNro>4521</CbteNro></FECompUltimoAutorizadoResult>';
    expect(parsearUltimoAutorizado(xml)).toBe(4521);
  });

  it('parsearRespuestaFecae interpreta un comprobante aprobado', () => {
    const xml =
      '<FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>71234567891234</CAE>' +
      '<CAEFchVto>20260805</CAEFchVto></FECAEDetResponse></FeDetResp>';
    const resultado = parsearRespuestaFecae(xml);
    expect(resultado).toEqual({ resultado: 'A', cae: '71234567891234', caeFchVto: '20260805', observaciones: null, errores: null });
  });

  it('parsearRespuestaFecae interpreta un rechazo con observaciones', () => {
    const xml =
      '<FeDetResp><FECAEDetResponse><Resultado>R</Resultado>' +
      '<Observaciones><Obs><Code>10016</Code><Msg>Doc. Nro invalido</Msg></Obs></Observaciones>' +
      '</FECAEDetResponse></FeDetResp>';
    const resultado = parsearRespuestaFecae(xml);
    expect(resultado.resultado).toBe('R');
    expect(resultado.cae).toBeNull();
    expect(resultado.observaciones).toBe('Doc. Nro invalido');
  });

  it('parsearRespuestaFecae devuelve resultado null ante una respuesta sin Resultado interpretable (falla técnica)', () => {
    const xml = '<Errors><Err><Code>500</Code><Msg>Internal error</Msg></Err></Errors>';
    const resultado = parsearRespuestaFecae(xml);
    expect(resultado.resultado).toBeNull();
    expect(resultado.errores).toBe('Internal error');
  });

  it('fechaAfip / normalizarFechaAfip son inversas entre YYYY-MM-DD y YYYYMMDD', () => {
    const yyyymmdd = fechaAfip(new Date('2026-07-20T15:00:00'));
    expect(yyyymmdd).toBe('20260720');
    expect(normalizarFechaAfip(yyyymmdd)).toBe('2026-07-20');
  });

  it('construirSobreFecaeSolicitar arma un único FECAEDetRequest con los importes discriminados', () => {
    const auth = { token: 't', sign: 's', cuit: '20111111112' };
    const sobre = construirSobreFecaeSolicitar(auth, 1, 6, {
      concepto: 1,
      docTipo: 96,
      docNro: '30123456',
      cbteNro: 42,
      cbteFch: '20260720',
      impTotal: 10656,
      impNeto: 8807.44,
      impIva: 1848.56,
    });
    expect(sobre).toContain('<ar:CbteDesde>42</ar:CbteDesde>');
    expect(sobre).toContain('<ar:CbteHasta>42</ar:CbteHasta>');
    expect(sobre).toContain('<ar:ImpTotal>10656.00</ar:ImpTotal>');
    expect(sobre).toContain('<ar:ImpNeto>8807.44</ar:ImpNeto>');
    expect(sobre).toContain('<ar:ImpIVA>1848.56</ar:ImpIVA>');
    expect(sobre).toContain('<ar:DocNro>30123456</ar:DocNro>');
  });
});
