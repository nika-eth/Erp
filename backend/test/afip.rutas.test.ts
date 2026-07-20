import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

describe('GET /api/afip/estado', () => {
  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).get('/api/afip/estado');
    expect(res.status).toBe(401);
  });

  it('devuelve online=true cuando no hay tareas pendientes ni falladas', async () => {
    resetQueryLog();
    setQueryHandler((sql) => {
      if (/FROM cola_facturacion_afip/.test(sql)) {
        return { rows: [{ pendientes: '0', fallidas: '0', ultima_contingencia: null }] };
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app).get('/api/afip/estado').set('Authorization', `Bearer ${crearToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ online: true, tareas_pendientes: 0, tareas_falladas: 0, ultima_contingencia: null });
  });

  it('devuelve online=false y el conteo cuando hay contingencia activa', async () => {
    resetQueryLog();
    setQueryHandler((sql) => {
      if (/FROM cola_facturacion_afip/.test(sql)) {
        return { rows: [{ pendientes: '3', fallidas: '1', ultima_contingencia: '2026-07-20T10:00:00.000Z' }] };
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app).get('/api/afip/estado').set('Authorization', `Bearer ${crearToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      online: false,
      tareas_pendientes: 3,
      tareas_falladas: 1,
      ultima_contingencia: '2026-07-20T10:00:00.000Z',
    });
  });
});

describe('POST /api/afip/reintentar/:idTarea', () => {
  it('rechaza con 403 a un VENDEDOR (requiere ADMIN o SUPERVISOR)', async () => {
    const res = await request(app)
      .post('/api/afip/reintentar/1')
      .set('Authorization', `Bearer ${crearToken({ rol: 'VENDEDOR' })}`);

    expect(res.status).toBe(403);
  });

  it('responde 404 si la tarea no existe o ya no está PENDIENTE', async () => {
    resetQueryLog();
    setQueryHandler((sql): MockQueryResult => {
      if (/SELECT t\.id_tarea/.test(sql)) return { rows: [] };
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .post('/api/afip/reintentar/999')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('TAREA_AFIP_NO_ENCONTRADA');
  });

  it('rechaza con 400 un idTarea no numérico', async () => {
    const res = await request(app)
      .post('/api/afip/reintentar/abc')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`);

    expect(res.status).toBe(400);
  });
});
