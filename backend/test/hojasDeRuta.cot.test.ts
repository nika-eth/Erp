import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const HOJA = {
  id_hoja_de_ruta: 5,
  id_camion: 1,
  chofer: 'Carlos Gomez',
  fecha_despacho: '2026-08-01',
  estado: 'BORRADOR',
  id_usuario_creo: 1,
  fecha_creacion: new Date().toISOString(),
  id_usuario_confirmo: null,
  fecha_confirmacion: null,
  motivo_anulacion: null,
  id_usuario_anulo: null,
  fecha_anulacion: null,
  nro_cot: null as string | null,
};

function crearHandler(opts: { hoja?: typeof HOJA | null }) {
  const { hoja = HOJA } = opts;

  return (sql: string): MockQueryResult => {
    if (/FROM hojas_de_ruta WHERE id_hoja_de_ruta = \$1$/.test(sql)) {
      return { rows: hoja ? [hoja] : [] };
    }
    if (/UPDATE hojas_de_ruta SET nro_cot = \$1/.test(sql)) {
      return { rows: hoja ? [{ ...hoja, nro_cot: 'COT-2026-000456' }] : [] };
    }
    if (/FROM hoja_de_ruta_ordenes hro\s+JOIN ordenes_entrega oe/.test(sql)) {
      return { rows: [] };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

const PAYLOAD_VALIDO = { nro_cot: 'COT-2026-000456' };

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('PUT /api/hojas-de-ruta/:id/cot', () => {
  it('carga el COT de la hoja de ruta mientras está en borrador', async () => {
    const token = crearToken();

    const res = await request(app).put('/api/hojas-de-ruta/5/cot').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(200);
    expect(res.body.hoja_de_ruta.nro_cot).toBe('COT-2026-000456');
  });

  it('rechaza con 400 si falta nro_cot', async () => {
    const token = crearToken();

    const res = await request(app).put('/api/hojas-de-ruta/5/cot').set('Authorization', `Bearer ${token}`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 si la hoja ya está en tránsito', async () => {
    setQueryHandler(crearHandler({ hoja: { ...HOJA, estado: 'EN_TRANSITO', nro_cot: 'COT-2026-000001' } }));
    const token = crearToken();

    const res = await request(app).put('/api/hojas-de-ruta/5/cot').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('HOJA_NO_EDITABLE');
  });

  it('rechaza con 400 si la hoja está anulada', async () => {
    setQueryHandler(crearHandler({ hoja: { ...HOJA, estado: 'ANULADA' } }));
    const token = crearToken();

    const res = await request(app).put('/api/hojas-de-ruta/5/cot').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('HOJA_NO_EDITABLE');
  });

  it('responde 404 si la hoja de ruta no existe', async () => {
    setQueryHandler(crearHandler({ hoja: null }));
    const token = crearToken();

    const res = await request(app).put('/api/hojas-de-ruta/999/cot').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('HOJA_DE_RUTA_NO_ENCONTRADA');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).put('/api/hojas-de-ruta/5/cot').send(PAYLOAD_VALIDO);
    expect(res.status).toBe(401);
  });
});
