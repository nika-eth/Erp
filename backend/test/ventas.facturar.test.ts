import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { queryLog, resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const CLIENTE_CUIT = {
  id_cliente: 1,
  nombre: 'Construcciones del Sur SA',
  cuit_dni: '30712345671', // 11 dígitos -> Factura A
  limite_credito: '500000.00',
  id_zona: 1,
};

const CLIENTE_DNI = {
  id_cliente: 2,
  nombre: 'Juan Perez',
  cuit_dni: '30123456', // 8 dígitos -> Factura B
  limite_credito: '50000.00',
  id_zona: null,
};

const CUENTAS_EMPRESA: Record<number, string> = { 1: 'Efectivo', 2: 'Banco Galicia' };

const ITEM = {
  id_material: 'HRA-12',
  descripcion: 'Hierro Redondo Aletado 12mm',
  cantidad: 10,
  peso_teorico_kg: 0.888,
  precio_unitario: 1200,
};
// kilos = 8.88, subtotal = 10656 -> ver documento.utils.redondearMoneda

let siguienteIdDocumento = 100;
let siguienteNroRemito = 1;

/**
 * Handler por defecto: resuelve cliente por CUIT, cuentas de empresa
 * conocidas, y arma las filas RETURNING de `documentos` / `cuenta_corriente`
 * a partir de los parámetros insertados (igual que haría Postgres real).
 */
function handlerFeliz(cliente: typeof CLIENTE_CUIT | typeof CLIENTE_DNI) {
  return (sql: string, params: unknown[]): MockQueryResult => {
    if (/FROM clientes WHERE id_cliente/.test(sql)) {
      return { rows: params[0] === cliente.id_cliente ? [cliente] : [] };
    }
    if (/FROM cuentas_empresa WHERE id_cuenta = ANY/.test(sql)) {
      const ids = params[0] as number[];
      return { rows: ids.filter((id) => id in CUENTAS_EMPRESA).map((id) => ({ id_cuenta: id, nombre_cuenta: CUENTAS_EMPRESA[id] })) };
    }
    if (/INSERT INTO documentos/.test(sql)) {
      const [id_sucursal_origen, cliente_id, total_neto, tipo_documento, items, id_zona] = params;
      return {
        rows: [
          {
            id_documento: siguienteIdDocumento++,
            id_sucursal_origen,
            nro_remito: siguienteNroRemito++,
            fecha: new Date().toISOString(),
            cliente_id,
            total_neto: String(total_neto),
            tipo_documento,
            items: JSON.parse(items as string),
            id_zona,
          },
        ],
      };
    }
    if (/INSERT INTO cuenta_corriente/.test(sql)) {
      if (params.length === 4) {
        // DEBE: [cliente_id, totalNeto, id_documento, concepto]
        const [cliente_id, debe, id_documento, concepto] = params;
        return {
          rows: [
            { id_movimiento: 1, cliente_id, fecha: new Date().toISOString(), debe: String(debe), haber: '0.00', id_documento, id_cuenta: null, concepto },
          ],
        };
      }
      // HABER: [cliente_id, monto, id_documento, id_cuenta, concepto]
      const [cliente_id, haber, id_documento, id_cuenta, concepto] = params;
      return {
        rows: [
          { id_movimiento: 2, cliente_id, fecha: new Date().toISOString(), debe: '0.00', haber: String(haber), id_documento, id_cuenta, concepto },
        ],
      };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(handlerFeliz(CLIENTE_CUIT));
});

describe('POST /api/ventas/facturar', () => {
  it('factura una venta con pago mixto y calcula el saldo pendiente', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cliente_id: CLIENTE_CUIT.id_cliente,
        items: [ITEM],
        total_neto: 999999, // el backend recalcula server-side; este valor no debe usarse
        pagos: [
          { id_cuenta: 1, monto: 6000 },
          { id_cuenta: 2, monto: 4000 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.documento.tipo_documento).toBe('FACTURA_A');
    expect(Number(res.body.documento.total_neto)).toBe(10656);
    expect(res.body.saldo_pendiente).toBe(656);

    expect(res.body.movimientos).toHaveLength(3);
    const [debe, pago1, pago2] = res.body.movimientos;
    expect(Number(debe.debe)).toBe(10656);
    expect(debe.concepto).toContain('Venta Factura A');
    expect(pago1.concepto).toBe(`Pago Efectivo - Remito ${res.body.documento.nro_remito}`);
    expect(pago2.concepto).toBe(`Pago Banco Galicia - Remito ${res.body.documento.nro_remito}`);
    expect(Number(pago1.haber) + Number(pago2.haber)).toBe(10000);
  });

  it('detecta Factura B para clientes con DNI', async () => {
    setQueryHandler(handlerFeliz(CLIENTE_DNI));
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cliente_id: CLIENTE_DNI.id_cliente,
        items: [ITEM],
        total_neto: 10656,
        pagos: [{ id_cuenta: 1, monto: 10656 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.documento.tipo_documento).toBe('FACTURA_B');
    expect(res.body.saldo_pendiente).toBe(0);
  });

  it('rebota con 422 cuando el trigger de límite de crédito rechaza la venta, y hace ROLLBACK', async () => {
    setQueryHandler((sql, params) => {
      if (/FROM clientes WHERE id_cliente/.test(sql)) return { rows: [CLIENTE_CUIT] };
      if (/FROM cuentas_empresa WHERE id_cuenta = ANY/.test(sql)) {
        const ids = params[0] as number[];
        return { rows: ids.map((id) => ({ id_cuenta: id, nombre_cuenta: CUENTAS_EMPRESA[id] })) };
      }
      if (/INSERT INTO documentos/.test(sql)) {
        return { rows: [{ id_documento: 999, id_sucursal_origen: 1, nro_remito: 1, fecha: new Date().toISOString(), cliente_id: CLIENTE_CUIT.id_cliente, total_neto: '10656', tipo_documento: 'FACTURA_A', items: [] }] };
      }
      if (/INSERT INTO cuenta_corriente/.test(sql) && params.length === 4) {
        const err = new Error('Limite de credito excedido para el cliente 1') as Error & { code: string };
        err.code = 'P0001';
        throw err;
      }
      throw new Error(`Query no esperada: ${sql}`);
    });
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cliente_id: CLIENTE_CUIT.id_cliente,
        items: [ITEM],
        total_neto: 10656,
        pagos: [{ id_cuenta: 1, monto: 10656 }],
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('LIMITE_CREDITO_EXCEDIDO');

    const ultimaQuery = queryLog[queryLog.length - 1];
    expect(ultimaQuery.sql.trim().toUpperCase()).toBe('ROLLBACK');
  });

  it('rechaza con 400 cuando la suma de los pagos supera el total de la venta', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cliente_id: CLIENTE_CUIT.id_cliente,
        items: [ITEM],
        total_neto: 10656,
        pagos: [{ id_cuenta: 1, monto: 999999 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAGO_EXCEDE_TOTAL');
  });

  it('rechaza con 400 cuando faltan ítems o medios de pago', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar')
      .set('Authorization', `Bearer ${token}`)
      .send({ cliente_id: CLIENTE_CUIT.id_cliente, items: [], total_neto: 0, pagos: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
    // No debe haber tocado la base de datos: la validación corta antes.
    expect(queryLog).toHaveLength(0);
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app)
      .post('/api/ventas/facturar')
      .send({ cliente_id: 1, items: [ITEM], total_neto: 10656, pagos: [{ id_cuenta: 1, monto: 10656 }] });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('NO_AUTORIZADO');
  });

  it('responde 404 si el cliente no existe', async () => {
    setQueryHandler((sql) => {
      if (/FROM clientes WHERE id_cliente/.test(sql)) return { rows: [] };
      throw new Error(`Query no esperada: ${sql}`);
    });
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar')
      .set('Authorization', `Bearer ${token}`)
      .send({ cliente_id: 404, items: [ITEM], total_neto: 10656, pagos: [{ id_cuenta: 1, monto: 10656 }] });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CLIENTE_NO_ENCONTRADO');
  });

  it('responde 400 si alguna cuenta de cobro no existe', async () => {
    setQueryHandler((sql, params) => {
      if (/FROM clientes WHERE id_cliente/.test(sql)) return { rows: [CLIENTE_CUIT] };
      if (/FROM cuentas_empresa WHERE id_cuenta = ANY/.test(sql)) {
        const ids = params[0] as number[];
        // Sólo existe la cuenta 1; cualquier otro id pedido "no existe".
        return { rows: ids.filter((id) => id === 1).map((id) => ({ id_cuenta: id, nombre_cuenta: CUENTAS_EMPRESA[id] })) };
      }
      throw new Error(`Query no esperada: ${sql}`);
    });
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar')
      .set('Authorization', `Bearer ${token}`)
      .send({ cliente_id: CLIENTE_CUIT.id_cliente, items: [ITEM], total_neto: 10656, pagos: [{ id_cuenta: 99, monto: 10656 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CUENTA_EMPRESA_INVALIDA');
  });
});
