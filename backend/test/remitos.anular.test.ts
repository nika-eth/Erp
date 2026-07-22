import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { queryLog, resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const REMITO_EMITIDO = {
  id_remito: 200,
  nro_remito: 'R-1-000002',
  id_documento_origen: 10,
  tipo_remito: 'R',
  id_remito_origen_x: null,
  es_regularizacion_stock: false,
  estado: 'EMITIDO',
  cliente_id: 1,
  id_sucursal: 1,
  id_camion: null,
  id_chofer: null,
  fecha_emision: new Date().toISOString(),
  motivo_anulacion: null,
  id_usuario_anulo: null,
  fecha_anulacion: null,
};

const DETALLES = [{ id_remito_detalle: 1, id_producto: 19, sku: 'AB1500', descripcion: 'Amoladora', cantidad_despachada: '5.000' }];

function crearHandler(opts: { remito?: typeof REMITO_EMITIDO | null }) {
  const { remito = REMITO_EMITIDO } = opts;

  return (sql: string): MockQueryResult => {
    if (/SELECT id_remito, nro_remito.*FROM remitos WHERE id_remito = \$1 FOR UPDATE/s.test(sql)) {
      return { rows: remito ? [remito] : [] };
    }
    if (/FROM remitos_detalles rd/.test(sql)) return { rows: DETALLES };
    if (/UPDATE stock_sucursal SET cantidad = cantidad \+/.test(sql)) return { rows: [] };
    if (/UPDATE stock_sucursal SET cantidad_reservada = cantidad_reservada \+/.test(sql)) return { rows: [] };
    if (/INSERT INTO reservas_stock/.test(sql)) return { rows: [] };
    if (/INSERT INTO stock_movements/.test(sql)) return { rows: [] };
    if (/UPDATE documentos_detalles SET cantidad_despachada_total = cantidad_despachada_total -/.test(sql)) {
      return { rows: [] };
    }
    if (/SELECT COALESCE\(SUM\(cantidad\), 0\)/.test(sql)) return { rows: [{ cantidad_total: '10', despachado_total: '0' }] };
    if (/UPDATE documentos SET estado_despacho/.test(sql)) return { rows: [] };
    if (/UPDATE remitos SET estado = 'ANULADO'/.test(sql)) {
      return { rows: [{ ...remito, estado: 'ANULADO', motivo_anulacion: 'no entra en la chata', id_usuario_anulo: 1 }] };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

const PAYLOAD_VALIDO = { motivo: 'no entra en la chata' };

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('POST /api/remitos/:id/anular', () => {
  it('anula el remito y devuelve el stock al depósito', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/200/anular')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(200);
    expect(res.body.remito.estado).toBe('ANULADO');
    expect(queryLog.some((q) => /UPDATE stock_sucursal SET cantidad = cantidad \+/.test(q.sql))).toBe(true);
    // Restitución virtual: re-reserva lo devuelto atado al documento (ledger).
    expect(queryLog.some((q) => /INSERT INTO reservas_stock/.test(q.sql))).toBe(true);
    expect(queryLog.some((q) => /UPDATE stock_sucursal SET cantidad_reservada = cantidad_reservada \+/.test(q.sql))).toBe(true);
  });

  it('NO devuelve stock ni re-reserva cuando el remito es de regularización', async () => {
    setQueryHandler(crearHandler({ remito: { ...REMITO_EMITIDO, es_regularizacion_stock: true } }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/200/anular')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(200);
    expect(queryLog.some((q) => /UPDATE stock_sucursal SET cantidad = cantidad \+/.test(q.sql))).toBe(false);
    expect(queryLog.some((q) => /INSERT INTO reservas_stock/.test(q.sql))).toBe(false);
    expect(queryLog.some((q) => /UPDATE documentos_detalles SET cantidad_despachada_total = cantidad_despachada_total -/.test(q.sql))).toBe(true);
  });

  it('rechaza con 400 si el remito ya está anulado', async () => {
    setQueryHandler(crearHandler({ remito: { ...REMITO_EMITIDO, estado: 'ANULADO' } }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/200/anular')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('REMITO_YA_ANULADO');
  });

  it('rechaza con 409 si el remito ya fue entregado', async () => {
    setQueryHandler(crearHandler({ remito: { ...REMITO_EMITIDO, estado: 'ENTREGADO' } }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/200/anular')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('REMITO_ENTREGADO');
  });

  it('responde 404 si el remito no existe', async () => {
    setQueryHandler(crearHandler({ remito: null }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/999/anular')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('REMITO_NO_ENCONTRADO');
  });

  it('rechaza con 400 si falta el motivo', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/200/anular')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).post('/api/remitos/200/anular').send(PAYLOAD_VALIDO);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('NO_AUTORIZADO');
  });

  it('rechaza con 403 si un VENDEDOR intenta anular un remito de otra sucursal', async () => {
    setQueryHandler(crearHandler({ remito: { ...REMITO_EMITIDO, id_sucursal: 2 } }));
    const token = crearToken({ rol: 'VENDEDOR', id_sucursal: 1 });

    const res = await request(app)
      .post('/api/remitos/200/anular')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(403);
  });

  it('permite a un ADMIN anular un remito de otra sucursal', async () => {
    setQueryHandler(crearHandler({ remito: { ...REMITO_EMITIDO, id_sucursal: 2 } }));
    const token = crearToken({ rol: 'ADMIN', id_sucursal: 1 });

    const res = await request(app)
      .post('/api/remitos/200/anular')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(200);
  });
});
