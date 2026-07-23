import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const FILAS = [
  {
    id_hoja_de_ruta: 5,
    id_camion: 1,
    patente: 'AB123CD',
    chofer: 'Carlos Gomez',
    fecha_despacho: '2026-08-01',
    estado: 'BORRADOR',
    nro_cot: null,
    cantidad_ordenes: '2',
  },
  {
    id_hoja_de_ruta: 4,
    id_camion: 1,
    patente: 'AB123CD',
    chofer: 'Carlos Gomez',
    fecha_despacho: '2026-07-30',
    estado: 'EN_TRANSITO',
    nro_cot: 'COT-2026-000123',
    cantidad_ordenes: '3',
  },
];

function crearHandler(opts: { filas?: typeof FILAS }) {
  const { filas = FILAS } = opts;

  return (sql: string): MockQueryResult => {
    if (/FROM hojas_de_ruta hr\s+JOIN camiones c/.test(sql)) {
      return { rows: filas };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('GET /api/hojas-de-ruta', () => {
  it('lista las hojas de ruta recientes, más nuevas primero', async () => {
    const token = crearToken();

    const res = await request(app).get('/api/hojas-de-ruta').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.hojas_de_ruta).toHaveLength(2);
    expect(res.body.hojas_de_ruta[0]).toMatchObject({
      id_hoja_de_ruta: 5,
      patente: 'AB123CD',
      estado: 'BORRADOR',
      cantidadOrdenes: 2,
    });
    expect(res.body.hojas_de_ruta[1]).toMatchObject({
      id_hoja_de_ruta: 4,
      estado: 'EN_TRANSITO',
      nro_cot: 'COT-2026-000123',
      cantidadOrdenes: 3,
    });
  });

  it('devuelve una lista vacía si no hay hojas de ruta', async () => {
    setQueryHandler(crearHandler({ filas: [] }));
    const token = crearToken();

    const res = await request(app).get('/api/hojas-de-ruta').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.hojas_de_ruta).toEqual([]);
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).get('/api/hojas-de-ruta');
    expect(res.status).toBe(401);
  });
});
