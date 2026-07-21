import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const PROVEEDOR = { id_proveedor: 1 };

const FACTURA_ARS = {
  id_proveedor: 1,
  moneda: 'ARS',
  cotizacion: '1',
  saldo: '1210.00',
  estado: 'PENDIENTE',
};

const NC_ARS = {
  id_proveedor: 1,
  moneda: 'ARS',
  cotizacion: '1',
  saldo: '100.00',
  estado: 'DISPONIBLE',
};

let idAsientoSecuencia = 1;
let idOpImputacionSecuencia = 1;

function ordenPagoInsertada(params: unknown[]) {
  const [id_proveedor, id_sucursal, fecha, moneda, total_facturas, total_notas_credito, total_anticipos, total_retenciones, neto_a_pagar] = params;
  return {
    id_orden_pago: 1,
    nro_op: 'OP-1-000001',
    id_proveedor,
    id_sucursal,
    fecha,
    moneda,
    total_facturas: String(total_facturas),
    total_notas_credito: String(total_notas_credito),
    total_anticipos: String(total_anticipos),
    total_retenciones: String(total_retenciones),
    neto_a_pagar: String(neto_a_pagar),
    diferencia_cambio: '0',
    estado: 'EMITIDA',
    motivo_anulacion: null,
    id_usuario_anulo: null,
    fecha_anulacion: null,
    id_usuario_emitio: 1,
  };
}

function crearHandlerBase(opts: { factura?: typeof FACTURA_ARS | null; nc?: typeof NC_ARS | null }) {
  const { factura = FACTURA_ARS, nc = NC_ARS } = opts;
  let ultimaOrdenPago: ReturnType<typeof ordenPagoInsertada> | null = null;

  return (sql: string, params: unknown[]): MockQueryResult => {
    if (/SELECT id_proveedor FROM proveedores WHERE id_proveedor = \$1/.test(sql)) {
      return { rows: [PROVEEDOR] };
    }
    if (/FROM facturas_proveedor WHERE id_factura_proveedor = \$1 FOR UPDATE/.test(sql)) {
      return { rows: factura ? [factura] : [] };
    }
    if (/UPDATE facturas_proveedor SET saldo_pendiente/.test(sql)) {
      return { rows: [] };
    }
    if (/FROM notas_credito_proveedor WHERE id_nota_credito_proveedor = \$1 FOR UPDATE/.test(sql)) {
      return { rows: nc ? [nc] : [] };
    }
    if (/UPDATE notas_credito_proveedor SET saldo_disponible/.test(sql)) {
      return { rows: [] };
    }
    if (/INSERT INTO ordenes_pago/.test(sql)) {
      ultimaOrdenPago = ordenPagoInsertada(params);
      return { rows: [ultimaOrdenPago] };
    }
    if (/UPDATE ordenes_pago SET diferencia_cambio/.test(sql)) {
      const [diferencia_cambio] = params;
      return { rows: [{ ...(ultimaOrdenPago ?? ordenPagoInsertada(params)), diferencia_cambio: String(diferencia_cambio) }] };
    }
    if (/INSERT INTO op_imputaciones/.test(sql)) {
      const [id_orden_pago, ...resto] = params;
      idOpImputacionSecuencia += 1;
      return {
        rows: [
          {
            id_op_imputacion: idOpImputacionSecuencia,
            id_orden_pago,
            id_factura_proveedor: null,
            id_nota_credito_proveedor: null,
            id_anticipo_proveedor: null,
            monto_imputado: String(resto[1]),
          },
        ],
      };
    }
    if (/INSERT INTO op_medios_pago/.test(sql)) {
      const [id_orden_pago, tipo, monto] = params;
      return { rows: [{ id_op_medio_pago: 1, id_orden_pago, tipo, monto: String(monto), nro_cheque: null, banco_emisor: null, fecha_pago_cheque: null, cbu_destino: null, nro_operacion: null }] };
    }
    if (/SELECT id_cuenta_contable FROM plan_cuentas/.test(sql)) {
      return { rows: [{ id_cuenta_contable: 1 }] };
    }
    if (/INSERT INTO op_retenciones/.test(sql)) {
      const [id_orden_pago, tipo_retencion, base_imponible, alicuota, monto_retenido, id_cuenta_contable] = params;
      return { rows: [{ id_op_retencion: 1, id_orden_pago, tipo_retencion, base_imponible: String(base_imponible), alicuota: String(alicuota), monto_retenido: String(monto_retenido), nro_certificado: null, id_cuenta_contable }] };
    }
    if (/INSERT INTO asientos_contables/.test(sql)) {
      idAsientoSecuencia += 1;
      return { rows: [{ id_asiento: idAsientoSecuencia }] };
    }
    if (/INSERT INTO asientos_detalle/.test(sql)) {
      return { rows: [] };
    }
    throw new Error(`Query no esperada: ${sql}`);
  };
}

beforeEach(() => {
  resetQueryLog();
  idAsientoSecuencia = 1;
  idOpImputacionSecuencia = 1;
  setQueryHandler(crearHandlerBase({}));
});

describe('POST /api/ordenes-pago', () => {
  it('emite una OP simple que paga una factura ARS completa con un solo medio de pago', async () => {
    const res = await request(app)
      .post('/api/ordenes-pago')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({
        id_proveedor: 1,
        imputaciones: [{ tipo: 'FACTURA', id: 1, monto_imputado: 1210 }],
        medios_pago: [{ tipo: 'EFECTIVO', monto: 1210 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.orden_pago.nro_op).toBe('OP-1-000001');
    expect(res.body.orden_pago.neto_a_pagar).toBe('1210');
    expect(res.body.imputaciones).toHaveLength(1);
  });

  it('aplica una NC además de la factura, descontando el neto a pagar', async () => {
    const res = await request(app)
      .post('/api/ordenes-pago')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({
        id_proveedor: 1,
        imputaciones: [
          { tipo: 'FACTURA', id: 1, monto_imputado: 1210 },
          { tipo: 'NOTA_CREDITO', id: 1, monto_imputado: 100 },
        ],
        medios_pago: [{ tipo: 'TRANSFERENCIA', monto: 1110 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.orden_pago.neto_a_pagar).toBe('1110');
    expect(res.body.imputaciones).toHaveLength(2);
  });

  it('recalcula monto_retenido server-side e ignora cualquier valor mandado por el cliente', async () => {
    const handlerBase = crearHandlerBase({});
    setQueryHandler((sql, params): MockQueryResult => {
      if (/INSERT INTO op_retenciones/.test(sql)) {
        const [, , , , monto_retenido] = params;
        // base_imponible=1000, alicuota=0.02 => 20, nunca el 99999 que se intenta colar.
        expect(monto_retenido).toBe(20);
        return { rows: [{ id_op_retencion: 1, id_orden_pago: 1, tipo_retencion: 'GANANCIAS', base_imponible: '1000', alicuota: '0.02', monto_retenido: '20', nro_certificado: null, id_cuenta_contable: 1 }] };
      }
      return handlerBase(sql, params);
    });

    const res = await request(app)
      .post('/api/ordenes-pago')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({
        id_proveedor: 1,
        imputaciones: [{ tipo: 'FACTURA', id: 1, monto_imputado: 1210 }],
        retenciones: [{ tipo_retencion: 'GANANCIAS', base_imponible: 1000, alicuota: 0.02, monto_retenido: 99999 }],
        medios_pago: [{ tipo: 'EFECTIVO', monto: 1190 }],
      });

    expect(res.status).toBe(201);
  });

  it('rechaza con 409 si el monto imputado supera el saldo disponible de la factura', async () => {
    setQueryHandler(crearHandlerBase({ factura: { ...FACTURA_ARS, saldo: '500.00' } }));

    const res = await request(app)
      .post('/api/ordenes-pago')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({
        id_proveedor: 1,
        imputaciones: [{ tipo: 'FACTURA', id: 1, monto_imputado: 1000 }],
        medios_pago: [{ tipo: 'EFECTIVO', monto: 1000 }],
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('SALDO_INSUFICIENTE');
  });

  it('rechaza con 400 si los medios de pago no coinciden con el neto a pagar', async () => {
    const res = await request(app)
      .post('/api/ordenes-pago')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({
        id_proveedor: 1,
        imputaciones: [{ tipo: 'FACTURA', id: 1, monto_imputado: 1210 }],
        medios_pago: [{ tipo: 'EFECTIVO', monto: 900 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MEDIOS_PAGO_NO_COINCIDEN');
  });

  it('rechaza con 400 si no hay imputaciones', async () => {
    const res = await request(app)
      .post('/api/ordenes-pago')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ id_proveedor: 1, imputaciones: [], medios_pago: [{ tipo: 'EFECTIVO', monto: 100 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 403 a un VENDEDOR', async () => {
    const res = await request(app)
      .post('/api/ordenes-pago')
      .set('Authorization', `Bearer ${crearToken({ rol: 'VENDEDOR' })}`)
      .send({
        id_proveedor: 1,
        imputaciones: [{ tipo: 'FACTURA', id: 1, monto_imputado: 1210 }],
        medios_pago: [{ tipo: 'EFECTIVO', monto: 1210 }],
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACCESO_DENEGADO');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app)
      .post('/api/ordenes-pago')
      .send({ id_proveedor: 1, imputaciones: [{ tipo: 'FACTURA', id: 1, monto_imputado: 1210 }], medios_pago: [{ tipo: 'EFECTIVO', monto: 1210 }] });

    expect(res.status).toBe(401);
  });
});
