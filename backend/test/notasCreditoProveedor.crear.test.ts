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
  tipo_comprobante: 'NOTA_CREDITO_A',
  punto_venta: 1,
  nro_comprobante: 50,
  fecha_emision: '2026-07-21',
  importe_total: 100,
};

function manejarAsientoReversa(sql: string): MockQueryResult | undefined {
  if (/SELECT id_cuenta_contable FROM plan_cuentas/.test(sql)) {
    return { rows: [{ id_cuenta_contable: 1 }] };
  }
  if (/INSERT INTO asientos_contables/.test(sql)) {
    return { rows: [{ id_asiento: 1 }] };
  }
  if (/INSERT INTO asientos_detalle/.test(sql)) {
    return { rows: [] };
  }
  return undefined;
}

describe('POST /api/notas-credito-proveedor', () => {
  it('crea una NC y genera el asiento de reversa contra Compras', async () => {
    setQueryHandler((sql, params): MockQueryResult => {
      const asiento = manejarAsientoReversa(sql);
      if (asiento) return asiento;
      if (/INSERT INTO notas_credito_proveedor/.test(sql)) {
        const [id_proveedor, id_factura_proveedor, tipo_comprobante, punto_venta, nro_comprobante, fecha_emision, moneda, cotizacion, importe_total] = params;
        return {
          rows: [
            {
              id_nota_credito_proveedor: 1,
              id_proveedor,
              id_factura_proveedor,
              tipo_comprobante,
              punto_venta,
              nro_comprobante,
              fecha_emision,
              moneda,
              cotizacion: String(cotizacion),
              importe_total: String(importe_total),
              saldo_disponible: String(importe_total),
              estado: 'DISPONIBLE',
            },
          ],
        };
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .post('/api/notas-credito-proveedor')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send(PAYLOAD_BASE);

    expect(res.status).toBe(201);
    expect(res.body.notaCredito).toMatchObject({ id_nota_credito_proveedor: 1, importe_total: '100', saldo_disponible: '100' });
  });

  /**
   * Regresión: un error de FK sobre `notas_credito_proveedor` (mensaje que
   * incluye "credito", substring de "crédito" del nombre de la tabla) no
   * debe confundirse con el trigger de límite de crédito de clientes — ver
   * fix en `utils/pgError.ts::esErrorLimiteCredito`.
   */
  it('rechaza con 400 REFERENCIA_INVALIDA (no 422 LIMITE_CREDITO_EXCEDIDO) si id_proveedor no existe', async () => {
    setQueryHandler((sql): MockQueryResult => {
      if (/INSERT INTO notas_credito_proveedor/.test(sql)) {
        const err = new Error(
          'insert or update on table "notas_credito_proveedor" violates foreign key constraint "notas_credito_proveedor_id_proveedor_fkey"',
        ) as Error & { code: string };
        err.code = '23503';
        throw err;
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .post('/api/notas-credito-proveedor')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ ...PAYLOAD_BASE, id_proveedor: 9999 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('REFERENCIA_INVALIDA');
  });

  it('rechaza con 403 a un VENDEDOR', async () => {
    const res = await request(app)
      .post('/api/notas-credito-proveedor')
      .set('Authorization', `Bearer ${crearToken({ rol: 'VENDEDOR' })}`)
      .send(PAYLOAD_BASE);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACCESO_DENEGADO');
  });
});
