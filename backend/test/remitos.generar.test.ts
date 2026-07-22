import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { queryLog, resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const DOCUMENTO_FISCAL = {
  id_documento: 10,
  cliente_id: 1,
  id_sucursal_origen: 1,
  es_fiscal: true,
  tipo_documento: 'FACTURA_A',
};

const DOCUMENTO_INTERNO = { ...DOCUMENTO_FISCAL, es_fiscal: false };

function remitoInsertado(documento: typeof DOCUMENTO_FISCAL) {
  return {
    id_remito: 100,
    nro_remito: 'R-1-000001',
    id_documento_origen: documento.id_documento,
    tipo_remito: documento.es_fiscal ? 'R' : 'X',
    id_remito_origen_x: null,
    es_regularizacion_stock: false,
    estado: 'EMITIDO',
    cliente_id: documento.cliente_id,
    id_sucursal: documento.id_sucursal_origen,
    id_camion: null,
    id_chofer: null,
    fecha_emision: new Date().toISOString(),
    motivo_anulacion: null,
    id_usuario_anulo: null,
    fecha_anulacion: null,
  };
}

function crearHandler(opts: {
  documento?: typeof DOCUMENTO_FISCAL | null;
  detalle?: { cantidad: string; cantidad_despachada_total: string; peso_teorico_kg?: string; sku?: string } | null;
  stock?: { cantidad: string; cantidad_reservada?: string } | null;
  reservaPropia?: string | null;
}) {
  const {
    documento = DOCUMENTO_FISCAL,
    detalle = { cantidad: '10.000', cantidad_despachada_total: '0.000', peso_teorico_kg: '2.400', sku: 'AB1500' },
    stock = { cantidad: '50.000', cantidad_reservada: '0.000' },
    reservaPropia = null,
  } = opts;

  return (sql: string): MockQueryResult => {
    if (/FROM reservas_stock\s+WHERE id_documento = \$1/.test(sql)) {
      return { rows: reservaPropia ? [{ cantidad: reservaPropia }] : [] };
    }
    if (/UPDATE stock_sucursal SET cantidad_reservada = cantidad_reservada -/.test(sql)) return { rows: [] };
    if (/UPDATE reservas_stock SET cantidad = cantidad -/.test(sql)) return { rows: [] };
    if (/FROM documentos WHERE id_documento = \$1 FOR UPDATE/.test(sql)) {
      return { rows: documento ? [documento] : [] };
    }
    if (/SELECT peso_teorico_kg, sku FROM documentos_detalles/.test(sql)) {
      return { rows: detalle ? [detalle] : [] };
    }
    if (/SELECT cantidad, cantidad_despachada_total FROM documentos_detalles/.test(sql)) {
      return { rows: detalle ? [detalle] : [] };
    }
    if (/FROM stock_sucursal WHERE id_producto = \$1 AND id_sucursal = \$2 FOR UPDATE/.test(sql)) {
      return { rows: stock ? [stock] : [] };
    }
    if (/INSERT INTO remitos \(/.test(sql)) {
      return { rows: [remitoInsertado(documento!)] };
    }
    if (/INSERT INTO remitos_detalles/.test(sql)) return { rows: [] };
    if (/UPDATE stock_sucursal SET cantidad = cantidad - /.test(sql)) return { rows: [] };
    if (/INSERT INTO stock_movements/.test(sql)) return { rows: [] };
    if (/UPDATE documentos_detalles SET cantidad_despachada_total = cantidad_despachada_total \+/.test(sql)) {
      return { rows: [] };
    }
    if (/SELECT COALESCE\(SUM\(cantidad\), 0\)/.test(sql)) {
      return { rows: [{ cantidad_total: '10', despachado_total: '5' }] };
    }
    if (/UPDATE documentos SET estado_despacho/.test(sql)) return { rows: [] };
    if (/FROM remitos_detalles rd/.test(sql)) {
      return { rows: [{ id_remito_detalle: 1, id_producto: 19, sku: 'AB1500', descripcion: 'Amoladora', cantidad_despachada: '5.000' }] };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

const PAYLOAD_VALIDO = { id_documento: 10, items: [{ id_producto: 19, cantidad: 5 }] };

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('POST /api/remitos/generar', () => {
  it('genera un Remito R cuando el documento origen es fiscal', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/generar')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(201);
    expect(res.body.remito.tipo_remito).toBe('R');
    expect(res.body.remito.id_documento_origen).toBe(10);
    expect(res.body.remito.detalles).toHaveLength(1);
  });

  it('genera un Remito X cuando el documento origen es un Comprobante Interno', async () => {
    setQueryHandler(crearHandler({ documento: DOCUMENTO_INTERNO }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/generar')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(201);
    expect(res.body.remito.tipo_remito).toBe('X');
  });

  it('acepta un ítem cargado en kilos que equivale exactamente a unidades enteras', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/generar')
      .set('Authorization', `Bearer ${token}`)
      .send({ id_documento: 10, items: [{ id_producto: 19, cantidad: 4.8, unidad_ingreso: 'KG' }] });

    expect(res.status).toBe(201);
  });

  it('rechaza con 400 cuando los kilos pedidos no equivalen a una cantidad entera de unidades', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/generar')
      .set('Authorization', `Bearer ${token}`)
      .send({ id_documento: 10, items: [{ id_producto: 19, cantidad: 5, unidad_ingreso: 'KG' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CANTIDAD_KG_NO_ENTERA');
  });

  it('rechaza con 409 cuando la cantidad pedida supera el saldo pendiente de despacho', async () => {
    setQueryHandler(crearHandler({ detalle: { cantidad: '10.000', cantidad_despachada_total: '8.000' } }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/generar')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('SALDO_EXCEDIDO');
  });

  it('rechaza con 409 cuando no hay stock suficiente', async () => {
    setQueryHandler(crearHandler({ stock: { cantidad: '1.000', cantidad_reservada: '0.000' } }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/generar')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('STOCK_INSUFICIENTE');
  });

  it('rechaza con 409 cuando el físico alcanza pero está reservado por otra orden pendiente', async () => {
    // Físico 10, pero 6 ya reservados por otra Orden de Entrega: sólo hay 4
    // disponibles, y el remito pide 5 — debe fallar contra el disponible,
    // no contra el físico crudo (que alcanzaría).
    setQueryHandler(crearHandler({ stock: { cantidad: '10.000', cantidad_reservada: '6.000' } }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/generar')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('STOCK_INSUFICIENTE');
  });

  it('despacha consumiendo la reserva PROPIA del documento aunque el disponible global no alcance', async () => {
    // Físico 10, reservada 6 — pero esas 6 son reserva propia de este mismo
    // documento (p.ej. quedó tras anular su remito). El disponible global sería
    // 4 y un despacho de 5 chocaría; como es reserva propia, debe consumirla y
    // despachar sin error (es el corazón de la Anulación Correctiva).
    setQueryHandler(crearHandler({ stock: { cantidad: '10.000', cantidad_reservada: '6.000' }, reservaPropia: '6.000' }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/generar')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(201);
    // Consumió parte de la reserva propia (libera 5 de las 6 reservadas).
    expect(queryLog.some((q) => /UPDATE reservas_stock SET cantidad = cantidad -/.test(q.sql))).toBe(true);
  });

  it('rechaza con 400 si el producto no pertenece al documento', async () => {
    setQueryHandler(crearHandler({ detalle: null }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/generar')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PRODUCTO_NO_PERTENECE_AL_DOCUMENTO');
  });

  it('rechaza con 400 si el documento es un presupuesto', async () => {
    setQueryHandler(crearHandler({ documento: { ...DOCUMENTO_FISCAL, tipo_documento: 'PRESUPUESTO' } }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/generar')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('DOCUMENTO_NO_FACTURADO');
  });

  it('responde 404 si el documento no existe', async () => {
    setQueryHandler(crearHandler({ documento: null }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/generar')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('DOCUMENTO_NO_ENCONTRADO');
  });

  it('rechaza con 400 si faltan ítems', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/remitos/generar')
      .set('Authorization', `Bearer ${token}`)
      .send({ id_documento: 10, items: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).post('/api/remitos/generar').send(PAYLOAD_VALIDO);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('NO_AUTORIZADO');
  });

  it('rechaza con 403 si un VENDEDOR intenta despachar un documento de otra sucursal', async () => {
    setQueryHandler(crearHandler({ documento: { ...DOCUMENTO_FISCAL, id_sucursal_origen: 2 } }));
    const token = crearToken({ rol: 'VENDEDOR', id_sucursal: 1 });

    const res = await request(app)
      .post('/api/remitos/generar')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(403);
  });

  it('permite a un ADMIN despachar un documento de otra sucursal', async () => {
    setQueryHandler(crearHandler({ documento: { ...DOCUMENTO_FISCAL, id_sucursal_origen: 2 } }));
    const token = crearToken({ rol: 'ADMIN', id_sucursal: 1 });

    const res = await request(app)
      .post('/api/remitos/generar')
      .set('Authorization', `Bearer ${token}`)
      .send(PAYLOAD_VALIDO);

    expect(res.status).toBe(201);
  });
});
