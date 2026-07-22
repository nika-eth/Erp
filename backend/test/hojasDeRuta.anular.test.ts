import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const HOJA = {
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
};

function crearHandlerAnular(opts: { hoja?: typeof HOJA | null }) {
  const { hoja = HOJA } = opts;

  return (sql: string, params: unknown[]): MockQueryResult => {
    if (/FROM hojas_de_ruta WHERE id_hoja_de_ruta = \$1 FOR UPDATE/.test(sql)) {
      return { rows: hoja ? [hoja] : [] };
    }
    if (/UPDATE hojas_de_ruta SET estado = 'ANULADA'/.test(sql)) {
      return { rows: [{ ...hoja, estado: 'ANULADA', motivo_anulacion: params[0], id_usuario_anulo: params[1], fecha_anulacion: new Date().toISOString() }] };
    }
    if (/FROM hoja_de_ruta_ordenes hro\s+JOIN ordenes_entrega oe/.test(sql)) {
      return { rows: [] };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

const PAYLOAD_VALIDO = { motivo: 'se canceló el viaje' };

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandlerAnular({}));
});

describe('POST /api/hojas-de-ruta/:id/anular', () => {
  it('anula una hoja de ruta en borrador', async () => {
    const token = crearToken();

    const res = await request(app).post('/api/hojas-de-ruta/5/anular').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(200);
    expect(res.body.hoja_de_ruta.estado).toBe('ANULADA');
  });

  it('rechaza con 400 si falta el motivo', async () => {
    const token = crearToken();

    const res = await request(app).post('/api/hojas-de-ruta/5/anular').set('Authorization', `Bearer ${token}`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 si la hoja ya salió', async () => {
    setQueryHandler(crearHandlerAnular({ hoja: { ...HOJA, estado: 'EN_TRANSITO' } }));
    const token = crearToken();

    const res = await request(app).post('/api/hojas-de-ruta/5/anular').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('HOJA_YA_EN_TRANSITO');
  });

  it('rechaza con 400 si la hoja ya está anulada', async () => {
    setQueryHandler(crearHandlerAnular({ hoja: { ...HOJA, estado: 'ANULADA' } }));
    const token = crearToken();

    const res = await request(app).post('/api/hojas-de-ruta/5/anular').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('HOJA_YA_ANULADA');
  });

  it('responde 404 si la hoja no existe', async () => {
    setQueryHandler(crearHandlerAnular({ hoja: null }));
    const token = crearToken();

    const res = await request(app).post('/api/hojas-de-ruta/999/anular').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('HOJA_DE_RUTA_NO_ENCONTRADA');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).post('/api/hojas-de-ruta/5/anular').send(PAYLOAD_VALIDO);
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/hojas-de-ruta/:id/ordenes/:id_orden_entrega', () => {
  function crearHandlerQuitar(opts: { hoja?: typeof HOJA | null; relacion?: { id_hoja_de_ruta_orden: number } | null }) {
    const { hoja = HOJA, relacion = { id_hoja_de_ruta_orden: 1 } } = opts;

    return (sql: string): MockQueryResult => {
      if (/FROM hojas_de_ruta WHERE id_hoja_de_ruta = \$1 FOR UPDATE/.test(sql)) {
        return { rows: hoja ? [hoja] : [] };
      }
      if (/SELECT id_hoja_de_ruta_orden FROM hoja_de_ruta_ordenes WHERE/.test(sql)) {
        return { rows: relacion ? [relacion] : [] };
      }
      if (/DELETE FROM hoja_de_ruta_ordenes/.test(sql)) return { rows: [] };
      if (/FROM hoja_de_ruta_ordenes hro\s+JOIN ordenes_entrega oe/.test(sql)) {
        return { rows: [] };
      }
      throw new Error(`Query no esperada en el test: ${sql}`);
    };
  }

  it('quita una orden de una hoja en borrador', async () => {
    setQueryHandler(crearHandlerQuitar({}));
    const token = crearToken();

    const res = await request(app).delete('/api/hojas-de-ruta/5/ordenes/20').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.hoja_de_ruta.ordenes).toEqual([]);
  });

  it('rechaza con 400 si la hoja ya no está en borrador', async () => {
    setQueryHandler(crearHandlerQuitar({ hoja: { ...HOJA, estado: 'EN_TRANSITO' } }));
    const token = crearToken();

    const res = await request(app).delete('/api/hojas-de-ruta/5/ordenes/20').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('HOJA_NO_EDITABLE');
  });

  it('responde 404 si la orden no está en esa hoja', async () => {
    setQueryHandler(crearHandlerQuitar({ relacion: null }));
    const token = crearToken();

    const res = await request(app).delete('/api/hojas-de-ruta/5/ordenes/20').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ORDEN_NO_ESTA_EN_LA_HOJA');
  });
});
