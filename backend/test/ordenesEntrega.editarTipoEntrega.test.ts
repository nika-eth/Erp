import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const PRODUCTO = { id_producto: 1, sku: 'AB1500', descripcion: 'Amoladora' };

function ordenPendiente(overrides: Partial<{ id_sucursal_origen: number; estado: string; tipo_entrega: string }> = {}) {
  return {
    id_orden_entrega: 10,
    nro_orden: 'OE-1-000001',
    id_documento: 50,
    id_sucursal_origen: overrides.id_sucursal_origen ?? 1,
    cliente_id: 1,
    estado: overrides.estado ?? 'PENDIENTE',
    tipo_entrega: overrides.tipo_entrega ?? 'RETIRO_CLIENTE',
    direccion_envio: null,
    fecha_pactada_envio: null,
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

const DETALLE = {
  id_orden_entrega_detalle: 1,
  id_orden_entrega: 10,
  id_producto: PRODUCTO.id_producto,
  sku: PRODUCTO.sku,
  descripcion: PRODUCTO.descripcion,
  cantidad: '5.000',
};

function crearHandler(opts: { orden?: ReturnType<typeof ordenPendiente> | null; enViaje?: boolean }) {
  const { orden = ordenPendiente(), enViaje = false } = opts;

  return (sql: string, params: unknown[]): MockQueryResult => {
    if (/FROM ordenes_entrega WHERE nro_orden = \$1 FOR UPDATE/.test(sql)) {
      return { rows: orden ? [orden] : [] };
    }
    if (/FROM hoja_de_ruta_ordenes hro\s+JOIN hojas_de_ruta hr/.test(sql)) {
      return { rows: enViaje ? [{ id_hoja_de_ruta: 7 }] : [] };
    }
    if (/UPDATE ordenes_entrega SET tipo_entrega = \$1/.test(sql)) {
      const [tipo_entrega, direccion_envio, fecha_pactada_envio] = params;
      return { rows: [{ ...orden, tipo_entrega, direccion_envio, fecha_pactada_envio }] };
    }
    if (/FROM ordenes_entrega_detalles oed/.test(sql)) {
      return { rows: [DETALLE] };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('PUT /api/ordenes-entrega/:nro_orden/tipo-entrega', () => {
  it('edita de RETIRO_CLIENTE a ENVIO_DOMICILIO con dirección y fecha', async () => {
    const token = crearToken();

    const res = await request(app)
      .put('/api/ordenes-entrega/OE-1-000001/tipo-entrega')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo_entrega: 'ENVIO_DOMICILIO', direccion_envio: 'Ruta 9 km 45', fecha_pactada_envio: '2026-08-10' });

    expect(res.status).toBe(200);
    expect(res.body.orden_entrega.tipo_entrega).toBe('ENVIO_DOMICILIO');
    expect(res.body.orden_entrega.direccion_envio).toBe('Ruta 9 km 45');
    expect(res.body.orden_entrega.fecha_pactada_envio).toBe('2026-08-10');
  });

  it('edita de ENVIO_DOMICILIO de vuelta a RETIRO_CLIENTE (limpia dirección y fecha)', async () => {
    setQueryHandler(
      crearHandler({ orden: ordenPendiente({ tipo_entrega: 'ENVIO_DOMICILIO' }) }),
    );
    const token = crearToken();

    const res = await request(app)
      .put('/api/ordenes-entrega/OE-1-000001/tipo-entrega')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo_entrega: 'RETIRO_CLIENTE' });

    expect(res.status).toBe(200);
    expect(res.body.orden_entrega.tipo_entrega).toBe('RETIRO_CLIENTE');
    expect(res.body.orden_entrega.direccion_envio).toBeNull();
    expect(res.body.orden_entrega.fecha_pactada_envio).toBeNull();
  });

  it('rechaza con 400 si tipo_entrega no es válido', async () => {
    const token = crearToken();

    const res = await request(app)
      .put('/api/ordenes-entrega/OE-1-000001/tipo-entrega')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo_entrega: 'OTRO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 si ENVIO_DOMICILIO no trae dirección', async () => {
    const token = crearToken();

    const res = await request(app)
      .put('/api/ordenes-entrega/OE-1-000001/tipo-entrega')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo_entrega: 'ENVIO_DOMICILIO', fecha_pactada_envio: '2026-08-10' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 si ENVIO_DOMICILIO no trae fecha con formato válido', async () => {
    const token = crearToken();

    const res = await request(app)
      .put('/api/ordenes-entrega/OE-1-000001/tipo-entrega')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo_entrega: 'ENVIO_DOMICILIO', direccion_envio: 'Ruta 9 km 45' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('responde 404 si la orden no existe', async () => {
    setQueryHandler(crearHandler({ orden: null }));
    const token = crearToken();

    const res = await request(app)
      .put('/api/ordenes-entrega/OE-1-999999/tipo-entrega')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo_entrega: 'RETIRO_CLIENTE' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ORDEN_ENTREGA_NO_ENCONTRADA');
  });

  it('rechaza con 400 si la orden ya fue retirada', async () => {
    setQueryHandler(crearHandler({ orden: ordenPendiente({ estado: 'RETIRADA' }) }));
    const token = crearToken();

    const res = await request(app)
      .put('/api/ordenes-entrega/OE-1-000001/tipo-entrega')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo_entrega: 'ENVIO_DOMICILIO', direccion_envio: 'Ruta 9', fecha_pactada_envio: '2026-08-10' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ORDEN_NO_EDITABLE');
  });

  it('rechaza con 400 si la orden ya está anulada', async () => {
    setQueryHandler(crearHandler({ orden: ordenPendiente({ estado: 'ANULADA' }) }));
    const token = crearToken();

    const res = await request(app)
      .put('/api/ordenes-entrega/OE-1-000001/tipo-entrega')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo_entrega: 'ENVIO_DOMICILIO', direccion_envio: 'Ruta 9', fecha_pactada_envio: '2026-08-10' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ORDEN_NO_EDITABLE');
  });

  it('rechaza con 409 si la orden ya está cargada en una hoja de ruta activa', async () => {
    setQueryHandler(crearHandler({ orden: ordenPendiente({ tipo_entrega: 'ENVIO_DOMICILIO' }), enViaje: true }));
    const token = crearToken();

    const res = await request(app)
      .put('/api/ordenes-entrega/OE-1-000001/tipo-entrega')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo_entrega: 'RETIRO_CLIENTE' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ORDEN_ASIGNADA_A_HOJA');
  });

  it('rechaza con 403 si un VENDEDOR intenta editar una orden de otra sucursal', async () => {
    setQueryHandler(crearHandler({ orden: ordenPendiente({ id_sucursal_origen: 2 }) }));
    const token = crearToken({ rol: 'VENDEDOR', id_sucursal: 1 });

    const res = await request(app)
      .put('/api/ordenes-entrega/OE-1-000001/tipo-entrega')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo_entrega: 'ENVIO_DOMICILIO', direccion_envio: 'Ruta 9', fecha_pactada_envio: '2026-08-10' });

    expect(res.status).toBe(403);
  });

  it('permite a un ADMIN editar una orden de otra sucursal', async () => {
    setQueryHandler(crearHandler({ orden: ordenPendiente({ id_sucursal_origen: 2 }) }));
    const token = crearToken({ rol: 'ADMIN', id_sucursal: 1 });

    const res = await request(app)
      .put('/api/ordenes-entrega/OE-1-000001/tipo-entrega')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo_entrega: 'ENVIO_DOMICILIO', direccion_envio: 'Ruta 9', fecha_pactada_envio: '2026-08-10' });

    expect(res.status).toBe(200);
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app)
      .put('/api/ordenes-entrega/OE-1-000001/tipo-entrega')
      .send({ tipo_entrega: 'RETIRO_CLIENTE' });
    expect(res.status).toBe(401);
  });
});
