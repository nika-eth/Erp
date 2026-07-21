import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

beforeEach(() => {
  resetQueryLog();
});

const PAYLOAD_BASE = {
  id_proveedor: 1,
  tipo_comprobante: 'FACTURA_A',
  punto_venta: 1,
  nro_comprobante: 100,
  fecha_emision: '2026-07-20',
  importe_neto: 1000,
  importe_iva: 210,
};

describe('POST /api/facturas-proveedor', () => {
  it('crea una factura y recalcula importe_total server-side (nunca confía en el total del cliente)', async () => {
    setQueryHandler((sql, params): MockQueryResult => {
      if (/INSERT INTO facturas_proveedor/.test(sql)) {
        const [id_proveedor, tipo_comprobante, punto_venta, nro_comprobante, fecha_emision, fecha_vencimiento, moneda, cotizacion, importe_neto, importe_iva, importe_total] = params;
        expect(importe_total).toBe(1210);
        return {
          rows: [
            {
              id_factura_proveedor: 1,
              id_proveedor,
              tipo_comprobante,
              punto_venta,
              nro_comprobante,
              fecha_emision,
              fecha_vencimiento,
              moneda,
              cotizacion: String(cotizacion),
              importe_neto: String(importe_neto),
              importe_iva: String(importe_iva),
              importe_total: String(importe_total),
              saldo_pendiente: String(importe_total),
              estado: 'PENDIENTE',
            },
          ],
        };
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .post('/api/facturas-proveedor')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send(PAYLOAD_BASE);

    expect(res.status).toBe(201);
    expect(res.body.factura).toMatchObject({
      id_factura_proveedor: 1,
      importe_total: '1210',
      saldo_pendiente: '1210',
      estado: 'PENDIENTE',
    });
  });

  it('rechaza con 400 un tipo_comprobante inválido', async () => {
    const res = await request(app)
      .post('/api/facturas-proveedor')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ ...PAYLOAD_BASE, tipo_comprobante: 'REMITO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 una fecha_emision con formato inválido', async () => {
    const res = await request(app)
      .post('/api/facturas-proveedor')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ ...PAYLOAD_BASE, fecha_emision: '20-07-2026' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 una factura en USD sin cotizacion', async () => {
    const res = await request(app)
      .post('/api/facturas-proveedor')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ ...PAYLOAD_BASE, moneda: 'USD' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('acepta una factura en USD con cotizacion explícita', async () => {
    setQueryHandler((sql, params): MockQueryResult => {
      if (/INSERT INTO facturas_proveedor/.test(sql)) {
        const [id_proveedor, tipo_comprobante, punto_venta, nro_comprobante, fecha_emision, fecha_vencimiento, moneda, cotizacion, importe_neto, importe_iva, importe_total] = params;
        expect(moneda).toBe('USD');
        expect(cotizacion).toBe(1200.5);
        return {
          rows: [
            {
              id_factura_proveedor: 2,
              id_proveedor,
              tipo_comprobante,
              punto_venta,
              nro_comprobante,
              fecha_emision,
              fecha_vencimiento,
              moneda,
              cotizacion: String(cotizacion),
              importe_neto: String(importe_neto),
              importe_iva: String(importe_iva),
              importe_total: String(importe_total),
              saldo_pendiente: String(importe_total),
              estado: 'PENDIENTE',
            },
          ],
        };
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .post('/api/facturas-proveedor')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ ...PAYLOAD_BASE, moneda: 'USD', cotizacion: 1200.5 });

    expect(res.status).toBe(201);
  });

  it('rechaza con 400 un importe_neto negativo', async () => {
    const res = await request(app)
      .post('/api/facturas-proveedor')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ ...PAYLOAD_BASE, importe_neto: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 409 si ya existe una factura con ese proveedor/tipo/punto de venta/número', async () => {
    setQueryHandler((sql): MockQueryResult => {
      if (/INSERT INTO facturas_proveedor/.test(sql)) {
        const err = new Error('duplicate key value violates unique constraint "facturas_proveedor_id_proveedor_tipo_comprobante_punto_ve_key"') as Error & {
          code: string;
        };
        err.code = '23505';
        throw err;
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .post('/api/facturas-proveedor')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send(PAYLOAD_BASE);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('REGISTRO_DUPLICADO');
  });

  it('rechaza con 400 (referencia inválida traducida a 400) si id_proveedor no existe', async () => {
    setQueryHandler((sql): MockQueryResult => {
      if (/INSERT INTO facturas_proveedor/.test(sql)) {
        const err = new Error('insert or update on table "facturas_proveedor" violates foreign key constraint') as Error & {
          code: string;
        };
        err.code = '23503';
        throw err;
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .post('/api/facturas-proveedor')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ ...PAYLOAD_BASE, id_proveedor: 9999 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('REFERENCIA_INVALIDA');
  });

  it('rechaza con 403 a un VENDEDOR', async () => {
    const res = await request(app)
      .post('/api/facturas-proveedor')
      .set('Authorization', `Bearer ${crearToken({ rol: 'VENDEDOR' })}`)
      .send(PAYLOAD_BASE);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACCESO_DENEGADO');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).post('/api/facturas-proveedor').send(PAYLOAD_BASE);
    expect(res.status).toBe(401);
  });
});
