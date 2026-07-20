import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { queryLog, resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const CLIENTE = {
  id_cliente: 1,
  nombre: 'Ferretería Norte',
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
// total = 10656

function handlerFeliz() {
  let ultimoDocumento: Record<string, unknown> | null = null;

  return (sql: string, params: unknown[]): MockQueryResult => {
    if (/FROM clientes WHERE id_cliente/.test(sql)) return { rows: [CLIENTE] };
    if (/FROM cuentas_empresa WHERE id_cuenta = ANY/.test(sql)) {
      const ids = params[0] as number[];
      return { rows: ids.map((id) => ({ id_cuenta: id, nombre_cuenta: CUENTAS_EMPRESA[id] })) };
    }
    if (/INSERT INTO documentos/.test(sql)) {
      const [id_sucursal_origen, cliente_id, total_neto, tipo_documento, items, id_zona, es_fiscal, tipo_comprobante, punto_venta, estado_afip] =
        params;
      ultimoDocumento = {
        id_documento: 500,
        id_sucursal_origen,
        nro_remito: 77,
        fecha: new Date().toISOString(),
        cliente_id,
        total_neto: String(total_neto),
        tipo_documento,
        items: JSON.parse(items as string),
        id_zona,
        es_fiscal,
        tipo_comprobante,
        punto_venta,
        nro_comprobante_afip: null,
        cae: null,
        cae_vencimiento: null,
        estado_afip,
        error_afip_mensaje: null,
      };
      return { rows: [ultimoDocumento] };
    }
    if (/INSERT INTO cuenta_corriente/.test(sql)) {
      if (params.length === 4) {
        const [cliente_id, debe, id_documento, concepto] = params;
        return { rows: [{ id_movimiento: 1, cliente_id, fecha: new Date().toISOString(), debe: String(debe), haber: '0.00', id_documento, id_cuenta: null, concepto }] };
      }
      const [cliente_id, haber, id_documento, id_cuenta, concepto] = params;
      return { rows: [{ id_movimiento: 2, cliente_id, fecha: new Date().toISOString(), debe: '0.00', haber: String(haber), id_documento, id_cuenta, concepto }] };
    }
    // Sólo se llegan a ejecutar en el segundo test (`es_fiscal` por defecto,
    // sin certificado AFIP en el entorno de test => cae en CONTINGENCIA).
    if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    if (/UPDATE documentos SET estado_afip = \$1, error_afip_mensaje = \$2/.test(sql)) {
      const [estado_afip, error_afip_mensaje] = params;
      ultimoDocumento = { ...ultimoDocumento, estado_afip, error_afip_mensaje };
      return { rows: [ultimoDocumento] };
    }
    if (/INSERT INTO cola_facturacion_afip/.test(sql)) return { rows: [] };
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(handlerFeliz());
});

describe('POST /api/ventas/facturar con es_fiscal: false (Comprobante Interno / Remito X)', () => {
  it('resuelve el documento en el momento como APROBADO_INTERNO, sin tocar AFIP ni la cola de contingencia', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cliente_id: CLIENTE.id_cliente,
        items: [ITEM],
        total_neto: 10656,
        pagos: [{ id_cuenta: 1, monto: 10656 }],
        es_fiscal: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.documento.es_fiscal).toBe(false);
    expect(res.body.documento.estado_afip).toBe('APROBADO_INTERNO');
    expect(res.body.documento.cae).toBeNull();
    expect(res.body.saldo_pendiente).toBe(0);

    // Nunca debe haber intentado el lock de numeración AFIP, ni encolar
    // contingencia, ni actualizar cae/estado_afip después del alta.
    expect(queryLog.some((q) => /pg_advisory_xact_lock/.test(q.sql))).toBe(false);
    expect(queryLog.some((q) => /cola_facturacion_afip/.test(q.sql))).toBe(false);
    expect(queryLog.some((q) => /UPDATE documentos/.test(q.sql))).toBe(false);
  });

  it('sin es_fiscal en el payload, se comporta como venta fiscal (default true)', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cliente_id: CLIENTE.id_cliente,
        items: [ITEM],
        total_neto: 10656,
        pagos: [{ id_cuenta: 1, monto: 10656 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.documento.es_fiscal).toBe(true);
    // Sin certificado AFIP configurado en el entorno de test, cae en CONTINGENCIA (no en APROBADO_INTERNO).
    expect(res.body.documento.estado_afip).toBe('CONTINGENCIA');
  });
});
