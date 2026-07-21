import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const ENVIO_ACTUALIZADO = {
  id_envio: 5,
  id_documento: 50,
  casilleros_ocupados: 1,
  kilos_asignados: '100.00',
  nro_cot: '12345678',
};

const DETALLE_DOCUMENTO = { nro_remito: 10, cliente_nombre: 'Ferreteria Real SRL', zona_nombre: 'Zona Cercana' };

// Coincide con el id_sucursal por defecto de crearToken() (1).
const SUCURSAL_ENVIO = { id_sucursal_origen: 1 };

function crearHandler(opts: {
  envio?: typeof ENVIO_ACTUALIZADO | null;
  detalle?: typeof DETALLE_DOCUMENTO | null;
  sucursalEnvio?: typeof SUCURSAL_ENVIO | null;
}) {
  const { envio = ENVIO_ACTUALIZADO, detalle = DETALLE_DOCUMENTO, sucursalEnvio = SUCURSAL_ENVIO } = opts;

  return (sql: string): MockQueryResult => {
    if (/FROM envios e JOIN documentos d/.test(sql)) {
      return { rows: sucursalEnvio ? [sucursalEnvio] : [] };
    }
    if (/UPDATE envios SET nro_cot/.test(sql)) {
      return { rows: envio ? [envio] : [] };
    }
    if (/FROM documentos d\s+JOIN clientes/.test(sql)) {
      return { rows: detalle ? [detalle] : [] };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('PUT /api/logistica/envios/:id/cot', () => {
  it('carga el nro_cot de un envío ya asignado', async () => {
    const token = crearToken();

    const res = await request(app)
      .put('/api/logistica/envios/5/cot')
      .set('Authorization', `Bearer ${token}`)
      .send({ nro_cot: '12345678' });

    expect(res.status).toBe(200);
    expect(res.body.envio.nro_cot).toBe('12345678');
    expect(res.body.envio.cliente).toBe('Ferreteria Real SRL');
    expect(res.body.envio.nro_remito).toBe(10);
  });

  it('rechaza con 400 si no se manda nro_cot', async () => {
    const token = crearToken();

    const res = await request(app)
      .put('/api/logistica/envios/5/cot')
      .set('Authorization', `Bearer ${token}`)
      .send({ nro_cot: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('responde 404 si el envío no existe', async () => {
    setQueryHandler(crearHandler({ envio: null, sucursalEnvio: null }));
    const token = crearToken();

    const res = await request(app)
      .put('/api/logistica/envios/999/cot')
      .set('Authorization', `Bearer ${token}`)
      .send({ nro_cot: '12345678' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ENVIO_NO_ENCONTRADO');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).put('/api/logistica/envios/5/cot').send({ nro_cot: '12345678' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('NO_AUTORIZADO');
  });

  it('rechaza con 403 si un VENDEDOR intenta cargar el COT de un envío de otra sucursal', async () => {
    setQueryHandler(crearHandler({ sucursalEnvio: { id_sucursal_origen: 2 } }));
    const token = crearToken({ rol: 'VENDEDOR', id_sucursal: 1 });

    const res = await request(app)
      .put('/api/logistica/envios/5/cot')
      .set('Authorization', `Bearer ${token}`)
      .send({ nro_cot: '12345678' });

    expect(res.status).toBe(403);
  });

  it('permite a un ADMIN cargar el COT de un envío de otra sucursal', async () => {
    setQueryHandler(crearHandler({ sucursalEnvio: { id_sucursal_origen: 2 } }));
    const token = crearToken({ rol: 'ADMIN', id_sucursal: 1 });

    const res = await request(app)
      .put('/api/logistica/envios/5/cot')
      .set('Authorization', `Bearer ${token}`)
      .send({ nro_cot: '12345678' });

    expect(res.status).toBe(200);
  });
});
