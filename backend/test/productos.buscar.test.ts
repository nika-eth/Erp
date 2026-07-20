import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

describe('GET /api/productos', () => {
  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).get('/api/productos?buscar=hierro');
    expect(res.status).toBe(401);
  });

  it('devuelve [] sin tocar la base cuando el término tiene menos de 2 caracteres', async () => {
    resetQueryLog();
    setQueryHandler(() => {
      throw new Error('No debería consultar la base con un término tan corto.');
    });

    const res = await request(app)
      .get('/api/productos?buscar=h')
      .set('Authorization', `Bearer ${crearToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.productos).toEqual([]);
  });

  it('busca por sku o descripción entre los productos activos', async () => {
    resetQueryLog();
    setQueryHandler((sql, params): MockQueryResult => {
      if (/FROM productos/.test(sql)) {
        expect(params[0]).toBe('%hierro%');
        return {
          rows: [
            {
              id_producto: 1,
              sku: 'HRA-12',
              descripcion: 'Hierro Redondo Aletado 12mm',
              unidad_venta: 'KILO',
              peso_teorico_kg: '0.888',
              activo: true,
            },
          ],
        };
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .get('/api/productos?buscar=hierro')
      .set('Authorization', `Bearer ${crearToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.productos).toHaveLength(1);
    expect(res.body.productos[0].sku).toBe('HRA-12');
  });
});
