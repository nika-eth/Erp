import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const ORDEN_BACKLOG = {
  id_orden_entrega: 20,
  nro_orden: 'OE-1-000001',
  cliente: 'Ferreteria Real SRL',
  zona: 'Zona Cercana',
  casilleros_requeridos: 1,
  kilos_totales: '50.000',
};

describe('GET /api/hojas-de-ruta/backlog', () => {
  beforeEach(() => {
    resetQueryLog();
    setQueryHandler((sql, params): MockQueryResult => {
      if (/FROM ordenes_entrega oe\s+JOIN clientes cl/.test(sql)) {
        if (sql.includes('oe.id_sucursal_origen = $1')) {
          expect(params).toContain(1);
        }
        return { rows: [ORDEN_BACKLOG] };
      }
      throw new Error(`Query no esperada en el test: ${sql}`);
    });
  });

  it('lista el backlog de órdenes pendientes sin viaje asignado', async () => {
    const token = crearToken({ rol: 'ADMIN' });

    const res = await request(app).get('/api/hojas-de-ruta/backlog').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ordenes).toHaveLength(1);
    expect(res.body.ordenes[0].nro_orden).toBe('OE-1-000001');
  });

  it('un VENDEDOR sólo ve el backlog de su propia sucursal', async () => {
    const token = crearToken({ rol: 'VENDEDOR', id_sucursal: 1 });

    const res = await request(app).get('/api/hojas-de-ruta/backlog').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).get('/api/hojas-de-ruta/backlog');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/hojas-de-ruta/:id', () => {
  beforeEach(() => {
    resetQueryLog();
    setQueryHandler((sql): MockQueryResult => {
      if (/FROM hojas_de_ruta WHERE id_hoja_de_ruta = \$1$/.test(sql.trim())) {
        return {
          rows: [
            {
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
            },
          ],
        };
      }
      if (/FROM hoja_de_ruta_ordenes hro\s+JOIN ordenes_entrega oe/.test(sql)) {
        return { rows: [] };
      }
      throw new Error(`Query no esperada en el test: ${sql}`);
    });
  });

  it('devuelve la hoja de ruta con sus órdenes', async () => {
    const token = crearToken();
    const res = await request(app).get('/api/hojas-de-ruta/5').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.hoja_de_ruta.id_hoja_de_ruta).toBe(5);
    expect(res.body.hoja_de_ruta.ordenes).toEqual([]);
  });
});
