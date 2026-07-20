import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const CAMION = {
  id_camion: 1,
  patente: 'AB123CD',
  chofer: 'Carlos Gomez',
  capacidad_casilleros: 10,
  capacidad_kilos_max: '5000.00',
};

const ZONA_CERCANA = { id_zona: 1, nombre: 'Zona Cercana', casilleros_requeridos: 1 };
const ZONA_LEJANA = { id_zona: 3, nombre: 'Zona Lejana', casilleros_requeridos: 3 };

function documentoFacturado(overrides: Partial<{ id_zona: number | null; tipo_documento: string; kilos: number }> = {}) {
  const kilos = overrides.kilos ?? 100;
  return {
    id_documento: 50,
    nro_remito: 10,
    tipo_documento: overrides.tipo_documento ?? 'FACTURA_A',
    items: [{ id_material: 'X', descripcion: 'Item', cantidad: 1, peso_teorico_kg: kilos, kilos, precio_unitario: 100, subtotal: 100 }],
    id_zona: 'id_zona' in overrides ? overrides.id_zona : ZONA_CERCANA.id_zona,
    cliente_nombre: 'Cliente Test',
  };
}

/** Handler configurable: cada parámetro controla una etapa de la validación. */
function crearHandler(opts: {
  camion?: typeof CAMION | null;
  documento?: ReturnType<typeof documentoFacturado> | null;
  zona?: typeof ZONA_CERCANA | typeof ZONA_LEJANA | null;
  casillerosUsados?: number;
  kilosUsados?: number;
  errorAlInsertar?: Error & { code?: string };
}) {
  const { camion = CAMION, documento = documentoFacturado(), zona = ZONA_CERCANA, casillerosUsados = 0, kilosUsados = 0 } = opts;

  return (sql: string): MockQueryResult => {
    if (/FROM camiones WHERE id_camion = \$1 FOR UPDATE/.test(sql)) {
      return { rows: camion ? [camion] : [] };
    }
    if (/FROM documentos d\s+JOIN clientes/.test(sql)) {
      return { rows: documento ? [documento] : [] };
    }
    if (/FROM zonas WHERE id_zona/.test(sql)) {
      return { rows: zona ? [zona] : [] };
    }
    if (/SUM\(casilleros_ocupados\)/.test(sql)) {
      return { rows: [{ casilleros_usados: String(casillerosUsados), kilos_usados: String(kilosUsados) }] };
    }
    if (/INSERT INTO envios/.test(sql)) {
      if (opts.errorAlInsertar) throw opts.errorAlInsertar;
      return { rows: [{ id_envio: 999 }] };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

const PAYLOAD_VALIDO = { id_camion: 1, id_documento: 50, fecha_despacho: '2026-08-01' };

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('POST /api/logistica/asignar-envio', () => {
  it('asigna el remito al camión y devuelve los casilleros/kilos consumidos', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/logistica/asignar-envio')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(201);
    expect(res.body.envio.id_documento).toBe(50);
    expect(res.body.envio.cliente).toBe('Cliente Test');
    expect(res.body.envio.zona).toBe('Zona Cercana');
    expect(res.body.envio.casillerosRequeridos).toBe(1);
    expect(res.body.envio.kilosTotales).toBe(100);
  });

  it('rechaza con 409 cuando el remito supera los kilos disponibles del camión ese día', async () => {
    // Capacidad 5000kg, ya usados 4950kg -> sólo 50kg disponibles; el remito pesa 100kg.
    setQueryHandler(crearHandler({ kilosUsados: 4950 }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/logistica/asignar-envio')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CAPACIDAD_KILOS_EXCEDIDA');
  });

  it('rechaza con 409 cuando la zona del cliente no entra en los casilleros disponibles', async () => {
    // Capacidad 10 casilleros, ya usados 8 -> sólo 2 disponibles; Zona Lejana requiere 3.
    setQueryHandler(crearHandler({ casillerosUsados: 8, zona: ZONA_LEJANA, documento: documentoFacturado({ id_zona: ZONA_LEJANA.id_zona, kilos: 10 }) }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/logistica/asignar-envio')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CAPACIDAD_CASILLEROS_EXCEDIDA');
  });

  it('rechaza con 409 si el remito ya estaba asignado a otro envío (constraint unique)', async () => {
    const err = new Error('duplicate key value violates unique constraint "envios_id_documento_key"') as Error & {
      code: string;
      detail: string;
    };
    err.code = '23505';
    err.detail = 'Key (id_documento)=(50) already exists.';
    setQueryHandler(crearHandler({ errorAlInsertar: err }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/logistica/asignar-envio')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('REGISTRO_DUPLICADO');
  });

  it('rechaza con 400 si el cliente del remito no tiene zona asignada', async () => {
    setQueryHandler(crearHandler({ documento: documentoFacturado({ id_zona: null }) }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/logistica/asignar-envio')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CLIENTE_SIN_ZONA');
  });

  it('rechaza con 400 si el documento es un presupuesto (no facturado)', async () => {
    setQueryHandler(crearHandler({ documento: documentoFacturado({ tipo_documento: 'PRESUPUESTO' }) }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/logistica/asignar-envio')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('DOCUMENTO_NO_FACTURADO');
  });

  it('responde 404 si el camión no existe', async () => {
    setQueryHandler(crearHandler({ camion: null }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/logistica/asignar-envio')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CAMION_NO_ENCONTRADO');
  });

  it('responde 404 si el documento no existe', async () => {
    setQueryHandler(crearHandler({ documento: null }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/logistica/asignar-envio')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('DOCUMENTO_NO_ENCONTRADO');
  });

  it('rechaza con 400 si falta fecha_despacho o no tiene formato válido', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/logistica/asignar-envio')
      .set('Authorization', `Bearer ${token}`)
      .send({ id_camion: 1, id_documento: 50, fecha_despacho: '01/08/2026' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).post('/api/logistica/asignar-envio').send(PAYLOAD_VALIDO);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('NO_AUTORIZADO');
  });
});
