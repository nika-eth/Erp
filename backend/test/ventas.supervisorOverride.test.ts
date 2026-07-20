import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { queryLog, resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const CLIENTE = {
  id_cliente: 1,
  nombre: 'Construcciones del Sur SA',
  cuit_dni: '30712345671',
  limite_credito: '500000.00',
  id_zona: null,
};

const CUENTAS_EMPRESA: Record<number, string> = { 1: 'Efectivo' };

const ITEM = {
  id_material: 'HRA-12',
  descripcion: 'Hierro Redondo Aletado 12mm',
  cantidad: 10,
  peso_teorico_kg: 0.888,
  precio_unitario: 1200,
};
// subtotal/total = 10656

let PIN_HASH: string;
let contadorId = 200;

beforeAll(async () => {
  PIN_HASH = await bcrypt.hash('4821', 4);
});

function handlerBase(opts: { saldoActual?: number; supervisorPinHash?: string | null } = {}) {
  const { saldoActual = 0, supervisorPinHash = PIN_HASH } = opts;
  let ultimoDocumento: Record<string, unknown> | null = null;

  return (sql: string, params: unknown[]): MockQueryResult => {
    if (/FROM clientes WHERE id_cliente/.test(sql)) {
      return { rows: [CLIENTE] };
    }
    if (/rol IN \('SUPERVISOR', 'ADMIN'\)/.test(sql)) {
      return {
        rows: supervisorPinHash
          ? [{ id_usuario: 99, nombre: 'Ana Supervisora', pin_autorizacion_hash: supervisorPinHash }]
          : [],
      };
    }
    if (/SET LOCAL app\.allow_credit_override/.test(sql)) {
      return { rows: [] };
    }
    if (/FROM cuentas_empresa WHERE id_cuenta = ANY/.test(sql)) {
      const ids = params[0] as number[];
      return { rows: ids.map((id) => ({ id_cuenta: id, nombre_cuenta: CUENTAS_EMPRESA[id] })) };
    }
    if (/INSERT INTO documentos/.test(sql)) {
      const [id_sucursal_origen, cliente_id, total_neto, tipo_documento, items, id_zona, tipo_comprobante, punto_venta] = params;
      ultimoDocumento = {
        id_documento: contadorId++,
        id_sucursal_origen,
        nro_remito: 1,
        fecha: new Date().toISOString(),
        cliente_id,
        total_neto: String(total_neto),
        tipo_documento,
        items: JSON.parse(items as string),
        id_zona,
        tipo_comprobante,
        punto_venta,
        nro_comprobante_afip: null,
        cae: null,
        cae_vencimiento: null,
        estado_afip: 'PENDIENTE',
        error_afip_mensaje: null,
      };
      return { rows: [ultimoDocumento] };
    }
    if (/SELECT COALESCE\(SUM\(debe\) - SUM\(haber\), 0\) AS saldo FROM cuenta_corriente/.test(sql)) {
      return { rows: [{ saldo: String(saldoActual) }] };
    }
    if (/INSERT INTO auditoria_autorizaciones/.test(sql)) {
      return { rows: [] };
    }
    if (/INSERT INTO cuenta_corriente/.test(sql)) {
      if (params.length === 4) {
        const [cliente_id, debe, id_documento, concepto] = params;
        return { rows: [{ id_movimiento: 1, cliente_id, fecha: new Date().toISOString(), debe: String(debe), haber: '0.00', id_documento, id_cuenta: null, concepto }] };
      }
      const [cliente_id, haber, id_documento, id_cuenta, concepto] = params;
      return { rows: [{ id_movimiento: 2, cliente_id, fecha: new Date().toISOString(), debe: '0.00', haber: String(haber), id_documento, id_cuenta, concepto }] };
    }
    if (/UPDATE documentos SET estado_afip = \$1, error_afip_mensaje = \$2/.test(sql)) {
      const [estado_afip, error_afip_mensaje] = params;
      ultimoDocumento = { ...ultimoDocumento, estado_afip, error_afip_mensaje };
      return { rows: [ultimoDocumento] };
    }
    if (/UPDATE documentos SET cae = \$1/.test(sql)) {
      const [cae, cae_vencimiento] = params;
      ultimoDocumento = { ...ultimoDocumento, cae, cae_vencimiento, estado_afip: 'APROBADO' };
      return { rows: [ultimoDocumento] };
    }
    if (/INSERT INTO cola_facturacion_afip/.test(sql)) {
      return { rows: [] };
    }
    if (/pg_advisory_xact_lock/.test(sql)) {
      return { rows: [] };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

const PAYLOAD = { cliente_id: 1, items: [ITEM], total_neto: 10656, pagos: [{ id_cuenta: 1, monto: 10656 }] };

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(handlerBase());
});

describe('POST /api/ventas/facturar con override de supervisor (x-supervisor-pin)', () => {
  it('sin header: no toca la auditoría ni el SET LOCAL (comportamiento normal)', async () => {
    const token = crearToken();

    const res = await request(app).post('/api/ventas/facturar').set('Authorization', `Bearer ${token}`).send(PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.autorizacion).toBeUndefined();
    expect(queryLog.some((q) => /SET LOCAL/.test(q.sql))).toBe(false);
    expect(queryLog.some((q) => /auditoria_autorizaciones/.test(q.sql))).toBe(false);
  });

  it('con PIN correcto: setea SET LOCAL, audita la autorización y devuelve el monto excedido', async () => {
    setQueryHandler(handlerBase({ saldoActual: 495000 })); // 495000 + 10656 = 505656, excede el límite (500000) por 5656
    const token = crearToken({ id_usuario: 42 });

    const res = await request(app)
      .post('/api/ventas/facturar')
      .set('Authorization', `Bearer ${token}`)
      .set('x-supervisor-pin', '4821')
      .send(PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.autorizacion).toEqual({ supervisor: 'Ana Supervisora', monto_excedido: 5656 });

    expect(queryLog.some((q) => /SET LOCAL app\.allow_credit_override/.test(q.sql))).toBe(true);
    const auditoria = queryLog.find((q) => /INSERT INTO auditoria_autorizaciones/.test(q.sql));
    expect(auditoria?.params).toEqual([42, 99, 1, 5656]);
  });

  it('rechaza con 401 un PIN que no coincide con ningún supervisor', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar')
      .set('Authorization', `Bearer ${token}`)
      .set('x-supervisor-pin', '0000')
      .send(PAYLOAD);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('PIN_SUPERVISOR_INVALIDO');
  });

  it('rechaza con 400 un PIN mal formado (no numérico de 4 dígitos)', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar')
      .set('Authorization', `Bearer ${token}`)
      .set('x-supervisor-pin', 'abcd')
      .send(PAYLOAD);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PIN_SUPERVISOR_INVALIDO');
  });

  it('rechaza con 401 si no hay ningún supervisor con PIN configurado', async () => {
    setQueryHandler(handlerBase({ supervisorPinHash: null }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar')
      .set('Authorization', `Bearer ${token}`)
      .set('x-supervisor-pin', '4821')
      .send(PAYLOAD);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('PIN_SUPERVISOR_INVALIDO');
  });
});
