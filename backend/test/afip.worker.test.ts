import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as wsfe from '../src/afip/wsfe.service';
import { procesarTarea } from '../src/afip/contingencia.worker';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';
import type { TareaConDocumento } from '../src/afip/cola.repository';

vi.mock('../src/afip/wsaa.service', () => ({
  obtenerTicketAcceso: vi.fn(async () => ({ token: 'TKN', sign: 'SGN', expiraEn: Date.now() + 60_000 })),
}));

vi.mock('../src/afip/wsfe.service', () => ({
  consultarUltimoAutorizado: vi.fn(),
  solicitarCae: vi.fn(),
  consultarComprobante: vi.fn(),
}));

const TAREA_BASE: TareaConDocumento = {
  id_tarea: 1,
  id_documento: 100,
  reintentos: 0,
  proximo_reintento: new Date().toISOString(),
  estado: 'PROCESANDO',
  ultimo_error: null,
  punto_venta: 1,
  tipo_comprobante: 6,
  nro_comprobante_afip: null,
  total_neto: '10656',
  tipo_documento_cliente: 'DNI',
  numero_documento: '30123456',
};

/** Registra en un mapa los UPDATE que le van llegando al mock de `pg`, simulando la persistencia mínima que necesita cada test. */
function handlerConEstado() {
  const estadoDocumento: Record<string, unknown> = {};
  const estadoTarea: Record<string, unknown> = {};

  const handler = (sql: string, params: unknown[]): MockQueryResult => {
    if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    if (/UPDATE comprobantes_afip SET nro_comprobante_afip/.test(sql)) {
      estadoDocumento.nro_comprobante_afip = params[0];
      return { rows: [] };
    }
    if (/UPDATE comprobantes_afip SET cae = \$1/.test(sql)) {
      estadoDocumento.cae = params[0];
      estadoDocumento.cae_vencimiento = params[1];
      estadoDocumento.estado_afip = 'APROBADO';
      return { rows: [] };
    }
    if (/UPDATE comprobantes_afip SET estado_afip = 'RECHAZADO'/.test(sql)) {
      estadoDocumento.estado_afip = 'RECHAZADO';
      estadoDocumento.error_afip_mensaje = params[0];
      return { rows: [] };
    }
    if (/UPDATE comprobantes_afip SET error_afip_mensaje/.test(sql)) {
      estadoDocumento.error_afip_mensaje = params[0];
      return { rows: [] };
    }
    if (/UPDATE cola_facturacion_afip SET estado = 'COMPLETADO'/.test(sql)) {
      estadoTarea.estado = 'COMPLETADO';
      return { rows: [] };
    }
    if (/UPDATE cola_facturacion_afip SET estado = 'FALLIDO'/.test(sql)) {
      estadoTarea.estado = 'FALLIDO';
      return { rows: [] };
    }
    if (/UPDATE cola_facturacion_afip\s+SET reintentos/.test(sql)) {
      estadoTarea.estado = params[1];
      estadoTarea.reintentos = params[0];
      return { rows: [] };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };

  return { handler, estadoDocumento, estadoTarea };
}

beforeEach(() => {
  resetQueryLog();
  vi.mocked(wsfe.consultarUltimoAutorizado).mockReset();
  vi.mocked(wsfe.solicitarCae).mockReset();
  vi.mocked(wsfe.consultarComprobante).mockReset();
});

describe('afip/contingencia.worker procesarTarea', () => {
  it('primer intento exitoso: pide el próximo número y aprueba con CAE', async () => {
    vi.mocked(wsfe.consultarUltimoAutorizado).mockResolvedValue(41);
    vi.mocked(wsfe.solicitarCae).mockResolvedValue({
      resultado: 'A',
      cae: '71234567891234',
      caeFchVto: '20260805',
      observaciones: null,
      errores: null,
    });

    const { handler, estadoDocumento, estadoTarea } = handlerConEstado();
    setQueryHandler(handler);

    await procesarTarea(TAREA_BASE);

    expect(wsfe.consultarUltimoAutorizado).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'TKN' }),
      1,
      6,
      expect.anything(),
    );
    const [, , , detalle] = vi.mocked(wsfe.solicitarCae).mock.calls[0];
    expect(detalle.cbteNro).toBe(42);
    expect(estadoDocumento).toMatchObject({ nro_comprobante_afip: 42, cae: '71234567891234', estado_afip: 'APROBADO' });
    expect(estadoTarea).toEqual({ estado: 'COMPLETADO' });
  });

  it('idempotencia: si ya había un número reservado y AFIP confirma que lo aprobó, no vuelve a pedir CAE', async () => {
    vi.mocked(wsfe.consultarComprobante).mockResolvedValue({
      resultado: 'A',
      cae: '71234567891234',
      caeFchVto: '20260805',
      observaciones: null,
      errores: null,
    });

    const { handler, estadoDocumento, estadoTarea } = handlerConEstado();
    setQueryHandler(handler);

    await procesarTarea({ ...TAREA_BASE, nro_comprobante_afip: 42, reintentos: 1 });

    expect(wsfe.consultarComprobante).toHaveBeenCalledWith(expect.anything(), 1, 6, 42, expect.anything());
    expect(wsfe.solicitarCae).not.toHaveBeenCalled();
    expect(wsfe.consultarUltimoAutorizado).not.toHaveBeenCalled();
    expect(estadoDocumento.estado_afip).toBe('APROBADO');
    expect(estadoTarea).toEqual({ estado: 'COMPLETADO' });
  });

  it('idempotencia: si AFIP no tiene registro del número reservado, reintenta FECAESolicitar con el mismo número (no pide uno nuevo)', async () => {
    vi.mocked(wsfe.consultarComprobante).mockResolvedValue({
      resultado: null,
      cae: null,
      caeFchVto: null,
      observaciones: null,
      errores: null,
    });
    vi.mocked(wsfe.solicitarCae).mockResolvedValue({
      resultado: 'A',
      cae: '71234500000001',
      caeFchVto: '20260805',
      observaciones: null,
      errores: null,
    });

    const { handler, estadoDocumento } = handlerConEstado();
    setQueryHandler(handler);

    await procesarTarea({ ...TAREA_BASE, nro_comprobante_afip: 42, reintentos: 1 });

    expect(wsfe.consultarUltimoAutorizado).not.toHaveBeenCalled();
    const [, , , detalle] = vi.mocked(wsfe.solicitarCae).mock.calls[0];
    expect(detalle.cbteNro).toBe(42);
    expect(estadoDocumento.cae).toBe('71234500000001');
  });

  it('rechazo explícito de AFIP marca el documento RECHAZADO y la tarea FALLIDO (no reintenta sola)', async () => {
    vi.mocked(wsfe.consultarUltimoAutorizado).mockResolvedValue(41);
    vi.mocked(wsfe.solicitarCae).mockResolvedValue({
      resultado: 'R',
      cae: null,
      caeFchVto: null,
      observaciones: 'CUIT del receptor no válido',
      errores: null,
    });

    const { handler, estadoDocumento, estadoTarea } = handlerConEstado();
    setQueryHandler(handler);

    await procesarTarea(TAREA_BASE);

    expect(estadoDocumento).toMatchObject({ estado_afip: 'RECHAZADO', error_afip_mensaje: 'CUIT del receptor no válido' });
    expect(estadoTarea).toEqual({ estado: 'FALLIDO' });
  });

  it('sigue sin poder contactar a AFIP: reprograma la tarea con backoff en vez de fallar', async () => {
    vi.mocked(wsfe.consultarUltimoAutorizado).mockRejectedValue(new Error('AFIP no responde'));

    const { handler, estadoTarea } = handlerConEstado();
    setQueryHandler(handler);

    await procesarTarea(TAREA_BASE);

    expect(estadoTarea).toEqual({ estado: 'PENDIENTE', reintentos: 1 });
  });
});
