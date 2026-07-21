import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

beforeEach(() => {
  resetQueryLog();
});

describe('POST /api/cotizaciones', () => {
  it('carga (upsert) la cotización del día y devuelve 201', async () => {
    setQueryHandler((sql, params): MockQueryResult => {
      if (/INSERT INTO cotizaciones/.test(sql)) {
        const [moneda, fecha, valor, id_usuario_carga] = params;
        expect(sql).toMatch(/ON CONFLICT \(moneda, fecha\) DO UPDATE/);
        return { rows: [{ id_cotizacion: 1, moneda, fecha, valor: String(valor), id_usuario_carga }] };
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ moneda: 'USD', fecha: '2026-07-21', valor: 1200.5 });

    expect(res.status).toBe(201);
    expect(res.body.cotizacion).toMatchObject({ moneda: 'USD', fecha: '2026-07-21', valor: '1200.5' });
  });

  it('rechaza con 400 un valor menor o igual a 0', async () => {
    const res = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ moneda: 'USD', fecha: '2026-07-21', valor: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 una fecha con formato inválido', async () => {
    const res = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ moneda: 'USD', fecha: '21/07/2026', valor: 1200 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 403 a un VENDEDOR', async () => {
    const res = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${crearToken({ rol: 'VENDEDOR' })}`)
      .send({ moneda: 'USD', fecha: '2026-07-21', valor: 1200 });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACCESO_DENEGADO');
  });
});
