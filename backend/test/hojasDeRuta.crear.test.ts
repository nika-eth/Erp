import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const CAMION = { id_camion: 1 };

function crearHandler(opts: { camion?: typeof CAMION | null }) {
  const { camion = CAMION } = opts;

  return (sql: string, params: unknown[]): MockQueryResult => {
    if (/SELECT id_camion FROM camiones WHERE id_camion = \$1/.test(sql)) {
      return { rows: camion ? [camion] : [] };
    }
    if (/INSERT INTO hojas_de_ruta/.test(sql)) {
      const [id_camion, chofer, fecha_despacho, id_usuario_creo] = params;
      return {
        rows: [
          {
            id_hoja_de_ruta: 1,
            id_camion,
            chofer,
            fecha_despacho,
            estado: 'BORRADOR',
            id_usuario_creo,
            fecha_creacion: new Date().toISOString(),
            id_usuario_confirmo: null,
            fecha_confirmacion: null,
            motivo_anulacion: null,
            id_usuario_anulo: null,
            fecha_anulacion: null,
          },
        ],
      };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('POST /api/hojas-de-ruta', () => {
  it('crea una hoja de ruta en borrador', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/hojas-de-ruta')
      .set('Authorization', `Bearer ${token}`)
      .send({ id_camion: 1, chofer: 'Carlos Gomez', fecha_despacho: '2026-08-01' });

    expect(res.status).toBe(201);
    expect(res.body.hoja_de_ruta.estado).toBe('BORRADOR');
    expect(res.body.hoja_de_ruta.ordenes).toEqual([]);
  });

  it('responde 404 si el camión no existe', async () => {
    setQueryHandler(crearHandler({ camion: null }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/hojas-de-ruta')
      .set('Authorization', `Bearer ${token}`)
      .send({ id_camion: 999, fecha_despacho: '2026-08-01' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CAMION_NO_ENCONTRADO');
  });

  it('rechaza con 400 si falta fecha_despacho', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/hojas-de-ruta')
      .set('Authorization', `Bearer ${token}`)
      .send({ id_camion: 1, fecha_despacho: '01/08/2026' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).post('/api/hojas-de-ruta').send({ id_camion: 1, fecha_despacho: '2026-08-01' });
    expect(res.status).toBe(401);
  });
});
