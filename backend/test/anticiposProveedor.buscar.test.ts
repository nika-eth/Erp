import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

beforeEach(() => {
  resetQueryLog();
});

describe('GET /api/anticipos-proveedor', () => {
  it('lista anticipos filtrando por id_proveedor y estado', async () => {
    setQueryHandler((sql, params): MockQueryResult => {
      if (/SELECT .* FROM anticipos_proveedor/.test(sql)) {
        expect(sql).toMatch(/WHERE id_proveedor = \$1 AND estado = \$2/);
        expect(params).toEqual([1, 'DISPONIBLE']);
        return {
          rows: [
            {
              id_anticipo_proveedor: 1,
              id_proveedor: 1,
              id_orden_pago_origen: 5,
              fecha: '2026-07-20',
              moneda: 'ARS',
              cotizacion: '1',
              importe_total: '5000',
              saldo_disponible: '5000',
              estado: 'DISPONIBLE',
            },
          ],
        };
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .get('/api/anticipos-proveedor?id_proveedor=1&estado=DISPONIBLE')
      .set('Authorization', `Bearer ${crearToken({ rol: 'SUPERVISOR' })}`);

    expect(res.status).toBe(200);
    expect(res.body.anticipos).toHaveLength(1);
    expect(res.body.anticipos[0].saldo_disponible).toBe('5000');
  });

  it('responde 404 al buscar un anticipo puntual inexistente', async () => {
    setQueryHandler((sql): MockQueryResult => {
      if (/SELECT .* FROM anticipos_proveedor/.test(sql)) {
        return { rows: [] };
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .get('/api/anticipos-proveedor/999')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ANTICIPO_PROVEEDOR_NO_ENCONTRADO');
  });

  it('rechaza con 403 a un VENDEDOR', async () => {
    const res = await request(app)
      .get('/api/anticipos-proveedor')
      .set('Authorization', `Bearer ${crearToken({ rol: 'VENDEDOR' })}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACCESO_DENEGADO');
  });
});
