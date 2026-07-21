import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const PRODUCTO = {
  id_producto: 5,
  sku: 'ALAMR4',
  descripcion: 'ALAMBRE RECOCIDO 4 mm',
  unidad_venta: 'KILO',
  peso_teorico_kg: '0.000',
  activo: true,
};

function crearHandler(opts: { productoActualizado?: typeof PRODUCTO | null }) {
  const { productoActualizado = { ...PRODUCTO, peso_teorico_kg: '0.850' } } = opts;

  return (sql: string): MockQueryResult => {
    if (/UPDATE productos SET/.test(sql)) {
      return { rows: productoActualizado ? [productoActualizado] : [] };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('PATCH /api/productos/:id', () => {
  it('actualiza peso_teorico_kg', async () => {
    const token = crearToken();

    const res = await request(app)
      .patch('/api/productos/5')
      .set('Authorization', `Bearer ${token}`)
      .send({ peso_teorico_kg: 0.85 });

    expect(res.status).toBe(200);
    expect(res.body.producto.peso_teorico_kg).toBe('0.850');
  });

  it('rechaza con 400 un peso negativo', async () => {
    const token = crearToken();

    const res = await request(app)
      .patch('/api/productos/5')
      .set('Authorization', `Bearer ${token}`)
      .send({ peso_teorico_kg: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 una unidad_venta inválida', async () => {
    const token = crearToken();

    const res = await request(app)
      .patch('/api/productos/5')
      .set('Authorization', `Bearer ${token}`)
      .send({ unidad_venta: 'LITRO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 una descripción vacía', async () => {
    const token = crearToken();

    const res = await request(app)
      .patch('/api/productos/5')
      .set('Authorization', `Bearer ${token}`)
      .send({ descripcion: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 si no se envía ningún campo', async () => {
    const token = crearToken();

    const res = await request(app)
      .patch('/api/productos/5')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('responde 404 si el producto no existe', async () => {
    setQueryHandler(crearHandler({ productoActualizado: null }));
    const token = crearToken();

    const res = await request(app)
      .patch('/api/productos/999')
      .set('Authorization', `Bearer ${token}`)
      .send({ peso_teorico_kg: 1 });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('PRODUCTO_NO_ENCONTRADO');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).patch('/api/productos/5').send({ peso_teorico_kg: 1 });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('NO_AUTORIZADO');
  });
});
