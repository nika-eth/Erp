import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const ORDEN_PAGO_EMITIDA = {
  id_orden_pago: 1,
  nro_op: 'OP-1-000001',
  id_proveedor: 1,
  id_sucursal: 1,
  fecha: '2026-07-21',
  moneda: 'ARS',
  total_facturas: '1210',
  total_notas_credito: '0',
  total_anticipos: '0',
  total_retenciones: '0',
  neto_a_pagar: '1210',
  diferencia_cambio: '0',
  estado: 'EMITIDA',
  motivo_anulacion: null,
  id_usuario_anulo: null,
  fecha_anulacion: null,
  id_usuario_emitio: 1,
};

function crearHandler(opts: { ordenPago?: typeof ORDEN_PAGO_EMITIDA | null }) {
  const { ordenPago = ORDEN_PAGO_EMITIDA } = opts;

  return (sql: string, params: unknown[]): MockQueryResult => {
    if (/FROM ordenes_pago WHERE id_orden_pago = \$1 FOR UPDATE/.test(sql)) {
      return { rows: ordenPago ? [ordenPago] : [] };
    }
    if (/FROM op_imputaciones WHERE id_orden_pago = \$1/.test(sql)) {
      return {
        rows: [
          { id_op_imputacion: 1, id_orden_pago: 1, id_factura_proveedor: 5, id_nota_credito_proveedor: null, id_anticipo_proveedor: null, monto_imputado: '1210.00' },
        ],
      };
    }
    if (/SELECT saldo_pendiente AS saldo, importe_total FROM facturas_proveedor WHERE id_factura_proveedor = \$1 FOR UPDATE/.test(sql)) {
      return { rows: [{ saldo: '0.00', importe_total: '1210.00' }] };
    }
    if (/UPDATE facturas_proveedor SET saldo_pendiente/.test(sql)) {
      return { rows: [] };
    }
    if (/SELECT id_asiento FROM asientos_contables WHERE id_orden_pago = \$1/.test(sql)) {
      return { rows: [{ id_asiento: 42 }] };
    }
    if (/SELECT id_cuenta_contable, debe, haber FROM asientos_detalle WHERE id_asiento = \$1/.test(sql)) {
      return {
        rows: [
          { id_cuenta_contable: 1, debe: '1210.00', haber: '0.00' },
          { id_cuenta_contable: 2, debe: '0.00', haber: '1210.00' },
        ],
      };
    }
    if (/INSERT INTO asientos_contables/.test(sql)) {
      return { rows: [{ id_asiento: 99 }] };
    }
    if (/INSERT INTO asientos_detalle/.test(sql)) {
      const [, id_cuenta_contable, debe, haber] = params;
      // La reversión debe invertir debe/haber respecto del asiento original
      // (llegan como string, igual que cualquier NUMERIC devuelto por pg).
      if (id_cuenta_contable === 1) expect([debe, haber]).toEqual(['0.00', '1210.00']);
      if (id_cuenta_contable === 2) expect([debe, haber]).toEqual(['1210.00', '0.00']);
      return { rows: [] };
    }
    if (/UPDATE ordenes_pago SET estado = 'ANULADA'/.test(sql)) {
      const [motivo_anulacion, id_usuario_anulo] = params;
      return { rows: [{ ...ORDEN_PAGO_EMITIDA, estado: 'ANULADA', motivo_anulacion, id_usuario_anulo, fecha_anulacion: new Date().toISOString() }] };
    }
    throw new Error(`Query no esperada: ${sql}`);
  };
}

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('POST /api/ordenes-pago/:id/anular', () => {
  it('anula la OP, revierte el saldo de la factura y genera el asiento de reversión', async () => {
    const res = await request(app)
      .post('/api/ordenes-pago/1/anular')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ motivo: 'Pago duplicado por error' });

    expect(res.status).toBe(200);
    expect(res.body.ordenPago.estado).toBe('ANULADA');
    expect(res.body.ordenPago.motivo_anulacion).toBe('Pago duplicado por error');
  });

  it('rechaza con 400 si no se manda motivo', async () => {
    const res = await request(app)
      .post('/api/ordenes-pago/1/anular')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 si la OP ya estaba anulada', async () => {
    setQueryHandler(crearHandler({ ordenPago: { ...ORDEN_PAGO_EMITIDA, estado: 'ANULADA' } }));

    const res = await request(app)
      .post('/api/ordenes-pago/1/anular')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ motivo: 'Intento repetido' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ORDEN_PAGO_YA_ANULADA');
  });

  it('responde 404 si la OP no existe', async () => {
    setQueryHandler(crearHandler({ ordenPago: null }));

    const res = await request(app)
      .post('/api/ordenes-pago/999/anular')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ motivo: 'No existe' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ORDEN_PAGO_NO_ENCONTRADA');
  });

  it('rechaza con 403 a un VENDEDOR', async () => {
    const res = await request(app)
      .post('/api/ordenes-pago/1/anular')
      .set('Authorization', `Bearer ${crearToken({ rol: 'VENDEDOR' })}`)
      .send({ motivo: 'Intento no autorizado' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACCESO_DENEGADO');
  });
});
