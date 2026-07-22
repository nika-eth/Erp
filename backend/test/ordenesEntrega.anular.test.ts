import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { queryLog, resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const PRODUCTO = { id_producto: 1, sku: 'AB1500', descripcion: 'Amoladora' };

function ordenPendiente(overrides: Partial<{ id_sucursal_origen: number; estado: string }> = {}) {
  return {
    id_orden_entrega: 10,
    nro_orden: 'OE-1-000001',
    id_documento: 50,
    id_sucursal_origen: overrides.id_sucursal_origen ?? 1,
    cliente_id: 1,
    estado: overrides.estado ?? 'PENDIENTE',
    fecha_creacion: new Date().toISOString(),
    id_usuario_creo: 1,
    id_sucursal_retiro: null,
    id_usuario_retiro: null,
    fecha_retiro: null,
    id_remito_retiro: null,
    motivo_anulacion: null,
    id_usuario_anulo: null,
    fecha_anulacion: null,
  };
}

const DETALLE = { id_orden_entrega_detalle: 1, id_orden_entrega: 10, id_producto: PRODUCTO.id_producto, sku: PRODUCTO.sku, descripcion: PRODUCTO.descripcion, cantidad: '5.000' };

function crearHandler(opts: { orden?: ReturnType<typeof ordenPendiente> | null }) {
  const { orden = ordenPendiente() } = opts;

  return (sql: string): MockQueryResult => {
    if (/FROM ordenes_entrega WHERE nro_orden = \$1 FOR UPDATE/.test(sql)) {
      return { rows: orden ? [orden] : [] };
    }
    if (/FROM ordenes_entrega_detalles oed/.test(sql)) {
      return { rows: [DETALLE] };
    }
    if (/UPDATE stock_sucursal SET cantidad_reservada = cantidad_reservada -/.test(sql)) return { rows: [] };
    if (/INSERT INTO stock_movements/.test(sql)) return { rows: [] };
    if (/UPDATE ordenes_entrega SET estado = 'ANULADA'/.test(sql)) {
      return { rows: [{ ...orden, estado: 'ANULADA', motivo_anulacion: 'no retirado', id_usuario_anulo: 1, fecha_anulacion: new Date().toISOString() }] };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

const PAYLOAD_VALIDO = { motivo: 'el cliente nunca retiró' };

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('POST /api/ordenes-entrega/:nro_orden/anular', () => {
  it('anula la orden y libera la reserva en la sucursal de origen', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/ordenes-entrega/OE-1-000001/anular')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(200);
    expect(res.body.orden_entrega.estado).toBe('ANULADA');
    expect(queryLog.some((q) => q.sql.includes('RESERVA_ANULADA'))).toBe(true);
  });

  it('rechaza con 400 si falta el motivo', async () => {
    const token = crearToken();

    const res = await request(app).post('/api/ordenes-entrega/OE-1-000001/anular').set('Authorization', `Bearer ${token}`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('responde 404 si la orden no existe', async () => {
    setQueryHandler(crearHandler({ orden: null }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/ordenes-entrega/OE-1-999999/anular')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ORDEN_ENTREGA_NO_ENCONTRADA');
  });

  it('rechaza con 400 si la orden ya fue retirada', async () => {
    setQueryHandler(crearHandler({ orden: ordenPendiente({ estado: 'RETIRADA' }) }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/ordenes-entrega/OE-1-000001/anular')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ORDEN_YA_RETIRADA');
  });

  it('rechaza con 400 si la orden ya está anulada', async () => {
    setQueryHandler(crearHandler({ orden: ordenPendiente({ estado: 'ANULADA' }) }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/ordenes-entrega/OE-1-000001/anular')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ORDEN_YA_ANULADA');
  });

  it('rechaza con 403 si un VENDEDOR intenta anular una orden de otra sucursal', async () => {
    setQueryHandler(crearHandler({ orden: ordenPendiente({ id_sucursal_origen: 2 }) }));
    const token = crearToken({ rol: 'VENDEDOR', id_sucursal: 1 });

    const res = await request(app)
      .post('/api/ordenes-entrega/OE-1-000001/anular')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(403);
  });

  it('permite a un ADMIN anular una orden de otra sucursal', async () => {
    setQueryHandler(crearHandler({ orden: ordenPendiente({ id_sucursal_origen: 2 }) }));
    const token = crearToken({ rol: 'ADMIN', id_sucursal: 1 });

    const res = await request(app)
      .post('/api/ordenes-entrega/OE-1-000001/anular')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(200);
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).post('/api/ordenes-entrega/OE-1-000001/anular').send(PAYLOAD_VALIDO);
    expect(res.status).toBe(401);
  });
});
