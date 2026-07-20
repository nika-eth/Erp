import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { queryLog, resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const CLIENTE = {
  id_cliente: 1,
  nombre: 'Construcciones del Sur SA',
  tipo_documento: 'CUIT',
  numero_documento: '30712345671',
  limite_credito: '500000.00',
  id_zona: null,
};

const CUENTAS_EMPRESA: Record<number, string> = { 1: 'Efectivo', 2: 'Banco Galicia' };

let siguienteIdRecibo = 500;
let siguienteNroRecibo = 1;
let siguienteIdDetalle = 900;
let siguienteIdMovimiento = 900;

function handlerFeliz(opts: { saldoDespues?: number } = {}) {
  const { saldoDespues = 0 } = opts;

  return (sql: string, params: unknown[]): MockQueryResult => {
    if (/FROM clientes WHERE id_cliente/.test(sql)) {
      return { rows: params[0] === CLIENTE.id_cliente ? [CLIENTE] : [] };
    }
    if (/FROM cuentas_empresa WHERE id_cuenta = ANY/.test(sql)) {
      const ids = params[0] as number[];
      return { rows: ids.filter((id) => id in CUENTAS_EMPRESA).map((id) => ({ id_cuenta: id, nombre_cuenta: CUENTAS_EMPRESA[id] })) };
    }
    if (/INSERT INTO recibos\b/.test(sql)) {
      const [cliente_id, id_sucursal, monto_total, id_usuario] = params;
      return {
        rows: [
          {
            id_recibo: siguienteIdRecibo++,
            nro_recibo: siguienteNroRecibo++,
            cliente_id,
            id_sucursal,
            fecha: new Date().toISOString(),
            monto_total: String(monto_total),
            id_usuario,
          },
        ],
      };
    }
    if (/INSERT INTO recibos_detalles_pago/.test(sql)) {
      const [id_recibo, id_cuenta, monto, nro_comprobante] = params;
      return {
        rows: [{ id_detalle: siguienteIdDetalle++, id_recibo, id_cuenta, monto: String(monto), nro_comprobante }],
      };
    }
    if (/INSERT INTO cuenta_corriente/.test(sql)) {
      const [cliente_id, haber, id_recibo, id_cuenta, concepto] = params;
      return {
        rows: [
          {
            id_movimiento: siguienteIdMovimiento++,
            cliente_id,
            fecha: new Date().toISOString(),
            debe: '0.00',
            haber: String(haber),
            id_documento: null,
            id_cuenta,
            id_recibo,
            concepto,
          },
        ],
      };
    }
    if (/SELECT COALESCE\(SUM\(debe\) - SUM\(haber\), 0\) AS saldo/.test(sql)) {
      return { rows: [{ saldo: String(saldoDespues) }] };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(handlerFeliz());
});

describe('POST /api/recibos/emitir', () => {
  it('emite un recibo con múltiples medios de pago y numeración correlativa', async () => {
    setQueryHandler(handlerFeliz({ saldoDespues: 8000 }));
    const token = crearToken({ id_usuario: 7 });

    const res = await request(app)
      .post('/api/recibos/emitir')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cliente_id: CLIENTE.id_cliente,
        pagos: [
          { id_cuenta: 1, monto: 5000 },
          { id_cuenta: 2, monto: 3000, nro_comprobante: '00012345' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.recibo.nro_recibo).toBe(1);
    expect(Number(res.body.recibo.monto_total)).toBe(8000);
    expect(res.body.saldo_actual).toBe(8000);

    expect(res.body.detalles).toHaveLength(2);
    expect(res.body.detalles[1].nro_comprobante).toBe('00012345');
    expect(res.body.detalles[0].nro_comprobante).toBeNull();

    expect(res.body.movimientos).toHaveLength(2);
    expect(res.body.movimientos[0].concepto).toBe(`Cobranza Recibo 1 - Efectivo`);
    expect(res.body.movimientos[1].concepto).toBe(`Cobranza Recibo 1 - Banco Galicia`);
    expect(Number(res.body.movimientos[0].haber) + Number(res.body.movimientos[1].haber)).toBe(8000);
  });

  it('rechaza con 400 si no hay medios de pago', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/recibos/emitir')
      .set('Authorization', `Bearer ${token}`)
      .send({ cliente_id: CLIENTE.id_cliente, pagos: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
    expect(queryLog).toHaveLength(0);
  });

  it('responde 404 si el cliente no existe', async () => {
    setQueryHandler((sql) => {
      if (/FROM clientes WHERE id_cliente/.test(sql)) return { rows: [] };
      throw new Error(`Query no esperada: ${sql}`);
    });
    const token = crearToken();

    const res = await request(app)
      .post('/api/recibos/emitir')
      .set('Authorization', `Bearer ${token}`)
      .send({ cliente_id: 404, pagos: [{ id_cuenta: 1, monto: 100 }] });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CLIENTE_NO_ENCONTRADO');
  });

  it('responde 400 si alguna cuenta de cobro no existe', async () => {
    setQueryHandler((sql, params) => {
      if (/FROM clientes WHERE id_cliente/.test(sql)) return { rows: [CLIENTE] };
      if (/FROM cuentas_empresa WHERE id_cuenta = ANY/.test(sql)) {
        const ids = params[0] as number[];
        return { rows: ids.filter((id) => id === 1).map((id) => ({ id_cuenta: id, nombre_cuenta: CUENTAS_EMPRESA[id] })) };
      }
      throw new Error(`Query no esperada: ${sql}`);
    });
    const token = crearToken();

    const res = await request(app)
      .post('/api/recibos/emitir')
      .set('Authorization', `Bearer ${token}`)
      .send({ cliente_id: CLIENTE.id_cliente, pagos: [{ id_cuenta: 99, monto: 100 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CUENTA_EMPRESA_INVALIDA');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app)
      .post('/api/recibos/emitir')
      .send({ cliente_id: 1, pagos: [{ id_cuenta: 1, monto: 100 }] });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('NO_AUTORIZADO');
  });
});
