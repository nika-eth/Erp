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
  id_zona: 1,
};

const CI = {
  id_documento: 50,
  id_sucursal_origen: 1,
  cliente_id: CLIENTE.id_cliente,
  total_neto: '10656.00',
  tipo_documento: 'FACTURA_A',
  id_zona: 1,
  es_fiscal: false,
  estado_facturacion_interna: 'PENDIENTE',
};

const ITEM_CI = {
  id_producto: 19,
  sku: 'AB1500',
  descripcion: 'Amoladora',
  unidad_venta: 'UNIDAD',
  cantidad: '1.000',
  peso_teorico_kg: '0.000',
  precio_unitario: '10656.00',
  subtotal: '10656.00',
  cantidad_despachada_total: '1.000',
};

const REMITO_X = { id_remito: 300, id_camion: null, id_chofer: null };
const DETALLES_REMITO_X = [{ id_remito_detalle: 1, id_producto: 19, sku: 'AB1500', descripcion: 'Amoladora', cantidad_despachada: '1.000' }];

function crearHandler(opts: { ci?: typeof CI | null; remitosX?: (typeof REMITO_X)[] }) {
  const { ci = CI, remitosX = [REMITO_X] } = opts;
  let nuevaFactura: Record<string, unknown> | null = null;
  let siguienteIdFactura = 900;

  return (sql: string, params: unknown[]): MockQueryResult => {
    if (/FROM documentos WHERE id_documento = \$1 FOR UPDATE/.test(sql)) {
      return { rows: ci ? [ci] : [] };
    }
    if (/FROM comprobantes_internos WHERE id_documento = \$1 FOR UPDATE/.test(sql)) {
      return { rows: ci ? [{ id_documento: ci.id_documento, correlativo_interno: 'X-1', estado_facturacion_interna: ci.estado_facturacion_interna }] : [] };
    }
    if (/FROM clientes WHERE id_cliente/.test(sql)) {
      return { rows: [CLIENTE] };
    }
    if (/INSERT INTO documentos\s*\(/.test(sql)) {
      const [id_sucursal_origen, cliente_id, total_neto, tipo_documento, id_zona, id_documento_origen_ci] = params;
      nuevaFactura = {
        id_documento: siguienteIdFactura++,
        id_sucursal_origen,
        nro_remito: 5,
        fecha: new Date().toISOString(),
        cliente_id,
        total_neto: String(total_neto),
        tipo_documento,
        id_zona,
        es_fiscal: true,
        id_documento_origen_ci,
        estado_despacho: 'PENDIENTE',
      };
      return { rows: [nuevaFactura] };
    }
    if (/INSERT INTO comprobantes_afip/.test(sql)) {
      const [id_documento, tipo_comprobante, punto_venta, estado_afip] = params;
      const comprobante = { id_documento, tipo_comprobante, punto_venta, nro_comprobante_afip: null, cae: null, cae_vencimiento: null, estado_afip, error_afip_mensaje: null };
      return { rows: [comprobante] };
    }
    if (/FROM documentos_detalles WHERE id_documento = \$1$/.test(sql.trim())) {
      return { rows: [ITEM_CI] };
    }
    if (/INSERT INTO documentos_detalles/.test(sql)) return { rows: [] };
    if (/UPDATE documentos_detalles dd SET/.test(sql)) return { rows: [] };
    if (/FROM remitos\s+WHERE id_documento_origen = \$1 AND tipo_remito = 'X'/.test(sql)) {
      return { rows: remitosX };
    }
    if (/FROM remitos_detalles rd/.test(sql)) return { rows: DETALLES_REMITO_X };
    if (/INSERT INTO remitos_detalles/.test(sql)) return { rows: [] };
    if (/INSERT INTO remitos\s*\(/.test(sql)) {
      return {
        rows: [
          {
            id_remito: 400,
            nro_remito: 'R-1-000010',
            id_documento_origen: (nuevaFactura as { id_documento: number }).id_documento,
            tipo_remito: 'R',
            id_remito_origen_x: REMITO_X.id_remito,
            es_regularizacion_stock: true,
            estado: 'EMITIDO',
            cliente_id: CLIENTE.id_cliente,
            id_sucursal: ci!.id_sucursal_origen,
            id_camion: null,
            id_chofer: null,
            fecha_emision: new Date().toISOString(),
            motivo_anulacion: null,
            id_usuario_anulo: null,
            fecha_anulacion: null,
          },
        ],
      };
    }
    if (/SELECT COALESCE\(SUM\(cantidad\), 0\)/.test(sql)) {
      return { rows: [{ cantidad_total: '1', despachado_total: '1' }] };
    }
    if (/UPDATE documentos SET estado_despacho/.test(sql)) return { rows: [] };
    if (/UPDATE comprobantes_internos SET estado_facturacion_interna = 'FACTURADA'/.test(sql)) return { rows: [] };
    if (/UPDATE comprobantes_afip SET estado_afip = \$1, error_afip_mensaje = \$2/.test(sql)) {
      const [estado_afip, error_afip_mensaje] = params;
      return { rows: [{ estado_afip, error_afip_mensaje }] };
    }
    if (/INSERT INTO cola_facturacion_afip/.test(sql)) return { rows: [] };
    if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('POST /api/ventas/:id/facturar-interno', () => {
  it('convierte el Comprobante Interno en Factura fiscal y genera el Remito R de regularización sin tocar stock', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/50/facturar-interno')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.documento.es_fiscal).toBe(true);
    expect(res.body.documento.id_documento_origen_ci).toBe(50);
    expect(res.body.remitos_regularizacion).toHaveLength(1);
    expect(res.body.remitos_regularizacion[0].es_regularizacion_stock).toBe(true);
    expect(queryLog.some((q) => /stock_sucursal/.test(q.sql))).toBe(false);
  });

  it('rechaza con 400 si el documento ya es fiscal', async () => {
    setQueryHandler(crearHandler({ ci: { ...CI, es_fiscal: true } }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/50/facturar-interno')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('DOCUMENTO_YA_FISCAL');
  });

  it('rechaza con 409 si el Comprobante Interno ya fue facturado', async () => {
    setQueryHandler(crearHandler({ ci: { ...CI, estado_facturacion_interna: 'FACTURADA' } }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/50/facturar-interno')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('YA_FACTURADO');
  });

  it('responde 404 si el documento no existe', async () => {
    setQueryHandler(crearHandler({ ci: null }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/999/facturar-interno')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('DOCUMENTO_NO_ENCONTRADO');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).post('/api/ventas/50/facturar-interno').send({});

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('NO_AUTORIZADO');
  });

  it('rechaza con 403 si un VENDEDOR intenta facturar un CI de otra sucursal', async () => {
    setQueryHandler(crearHandler({ ci: { ...CI, id_sucursal_origen: 2 } }));
    const token = crearToken({ rol: 'VENDEDOR', id_sucursal: 1 });

    const res = await request(app)
      .post('/api/ventas/50/facturar-interno')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('permite a un ADMIN facturar un CI de otra sucursal', async () => {
    setQueryHandler(crearHandler({ ci: { ...CI, id_sucursal_origen: 2 } }));
    const token = crearToken({ rol: 'ADMIN', id_sucursal: 1 });

    const res = await request(app)
      .post('/api/ventas/50/facturar-interno')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
  });
});
