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

const CUENTAS_EMPRESA: Record<number, string> = { 1: 'Efectivo' };

const PRODUCTO = {
  id_producto: 1,
  sku: 'AB1500',
  descripcion: 'Amoladora',
  unidad_venta: 'UNIDAD',
  peso_teorico_kg: '0.000',
  activo: true,
};

let siguienteIdDocumento = 500;
let siguienteIdRemito = 700;
let siguienteIdOrden = 900;

function crearHandler(opts: { stock?: { cantidad: string; cantidad_reservada: string } | null }) {
  const { stock = { cantidad: '50.000', cantidad_reservada: '0.000' } } = opts;
  let ultimoDocumento: Record<string, unknown> | null = null;
  let ultimoRemito: Record<string, unknown> | null = null;

  return (sql: string, params: unknown[]): MockQueryResult => {
    if (/FROM clientes WHERE id_cliente/.test(sql)) {
      return { rows: params[0] === CLIENTE.id_cliente ? [CLIENTE] : [] };
    }
    if (/FROM productos WHERE id_producto = ANY/.test(sql)) {
      const ids = params[0] as number[];
      return { rows: ids.filter((id) => id === PRODUCTO.id_producto).map(() => PRODUCTO) };
    }
    if (/FROM cuentas_empresa WHERE id_cuenta = ANY/.test(sql)) {
      const ids = params[0] as number[];
      return { rows: ids.filter((id) => id in CUENTAS_EMPRESA).map((id) => ({ id_cuenta: id, nombre_cuenta: CUENTAS_EMPRESA[id] })) };
    }
    if (/INSERT INTO documentos\s*\(/.test(sql)) {
      const [id_sucursal_origen, cliente_id, total_neto, tipo_documento, id_zona, es_fiscal, estado_afip, estado_facturacion_interna] =
        params;
      ultimoDocumento = {
        id_documento: siguienteIdDocumento++,
        id_sucursal_origen,
        nro_remito: 1,
        fecha: new Date().toISOString(),
        cliente_id,
        total_neto: String(total_neto),
        tipo_documento,
        id_zona,
        es_fiscal,
        tipo_comprobante: null,
        punto_venta: null,
        nro_comprobante_afip: null,
        cae: null,
        cae_vencimiento: null,
        estado_afip,
        error_afip_mensaje: null,
        id_documento_origen_ci: null,
        estado_facturacion_interna,
        estado_despacho: 'PENDIENTE',
      };
      return { rows: [ultimoDocumento] };
    }
    if (/INSERT INTO documentos_detalles/.test(sql)) return { rows: [] };
    if (/INSERT INTO cuenta_corriente/.test(sql)) return { rows: [] };
    if (/SELECT cantidad, cantidad_despachada_total FROM documentos_detalles/.test(sql)) {
      return { rows: [{ cantidad: '10.000', cantidad_despachada_total: '0.000' }] };
    }
    if (/SELECT cantidad FROM stock_sucursal WHERE/.test(sql)) {
      return { rows: stock ? [{ cantidad: stock.cantidad }] : [] };
    }
    if (/SELECT cantidad, cantidad_reservada FROM stock_sucursal/.test(sql)) {
      return { rows: stock ? [stock] : [] };
    }
    if (/UPDATE stock_sucursal SET cantidad = cantidad -/.test(sql)) return { rows: [] };
    if (/UPDATE stock_sucursal SET cantidad_reservada = cantidad_reservada \+/.test(sql)) return { rows: [] };
    if (/INSERT INTO stock_movements/.test(sql)) return { rows: [] };
    if (/INSERT INTO remitos\s*\(/.test(sql)) {
      const [id_documento_origen, tipo_remito, cliente_id, id_sucursal] = params;
      ultimoRemito = {
        id_remito: siguienteIdRemito++,
        nro_remito: `${tipo_remito}-${id_sucursal}-000001`,
        id_documento_origen,
        tipo_remito,
        id_remito_origen_x: null,
        es_regularizacion_stock: false,
        estado: 'ENTREGADO',
        cliente_id,
        id_sucursal,
        id_camion: null,
        id_chofer: null,
        fecha_emision: new Date().toISOString(),
        motivo_anulacion: null,
        id_usuario_anulo: null,
        fecha_anulacion: null,
      };
      return { rows: [ultimoRemito] };
    }
    if (/INSERT INTO remitos_detalles/.test(sql)) return { rows: [] };
    if (/UPDATE documentos_detalles SET cantidad_despachada_total = cantidad_despachada_total \+/.test(sql)) return { rows: [] };
    if (/SELECT COALESCE\(SUM\(cantidad\), 0\)/.test(sql)) return { rows: [{ cantidad_total: '10', despachado_total: '5' }] };
    if (/UPDATE documentos SET estado_despacho/.test(sql)) return { rows: [] };
    if (/FROM remitos_detalles rd/.test(sql)) {
      return { rows: [{ id_remito_detalle: 1, id_producto: PRODUCTO.id_producto, sku: PRODUCTO.sku, descripcion: PRODUCTO.descripcion, cantidad_despachada: '5.000' }] };
    }
    if (/INSERT INTO ordenes_entrega\s*\(/.test(sql)) {
      const [id_documento, id_sucursal_origen, cliente_id, id_usuario_creo, tipo_entrega, direccion_envio, fecha_pactada_envio] = params;
      return {
        rows: [
          {
            id_orden_entrega: siguienteIdOrden++,
            nro_orden: `OE-${id_sucursal_origen}-000001`,
            id_documento,
            id_sucursal_origen,
            cliente_id,
            estado: 'PENDIENTE',
            tipo_entrega,
            direccion_envio,
            fecha_pactada_envio,
            fecha_creacion: new Date().toISOString(),
            id_usuario_creo,
            id_sucursal_retiro: null,
            id_usuario_retiro: null,
            fecha_retiro: null,
            id_remito_retiro: null,
            motivo_anulacion: null,
            id_usuario_anulo: null,
            fecha_anulacion: null,
          },
        ],
      };
    }
    if (/INSERT INTO ordenes_entrega_detalles/.test(sql)) return { rows: [{ id_orden_entrega_detalle: 1 }] };
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('POST /api/ventas/facturar-mixta', () => {
  it('despacha todo de inmediato cuando cantidad_retiro_inmediato cubre toda la cantidad', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar-mixta')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cliente_id: 1,
        items: [{ id_producto: 1, cantidad: 5, precio_unitario: 1000, cantidad_retiro_inmediato: 5 }],
        pagos: [{ id_cuenta: 1, monto: 5000 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.remito_inmediato).not.toBeNull();
    expect(res.body.remito_inmediato.estado).toBe('ENTREGADO');
    expect(res.body.orden_entrega).toBeNull();
  });

  it('reserva todo y genera una Orden de Entrega cuando no hay retiro inmediato', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar-mixta')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cliente_id: 1,
        items: [{ id_producto: 1, cantidad: 5, precio_unitario: 1000 }],
        pagos: [{ id_cuenta: 1, monto: 5000 }],
        tipo_entrega: 'RETIRO_CLIENTE',
      });

    expect(res.status).toBe(201);
    expect(res.body.remito_inmediato).toBeNull();
    expect(res.body.orden_entrega).not.toBeNull();
    expect(res.body.orden_entrega.estado).toBe('PENDIENTE');
    expect(res.body.orden_entrega.tipo_entrega).toBe('RETIRO_CLIENTE');
    expect(res.body.orden_entrega.detalles).toHaveLength(1);
    expect(queryLog.some((q) => /RESERVA_CREADA/.test(q.sql))).toBe(true);
  });

  it('divide un mismo renglón entre retiro inmediato y reserva pendiente', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar-mixta')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cliente_id: 1,
        items: [{ id_producto: 1, cantidad: 10, precio_unitario: 1000, cantidad_retiro_inmediato: 4 }],
        pagos: [{ id_cuenta: 1, monto: 10000 }],
        tipo_entrega: 'ENVIO_DOMICILIO',
        direccion_envio: 'Av. Siempre Viva 742',
        fecha_pactada_envio: '2026-08-05',
      });

    expect(res.status).toBe(201);
    expect(res.body.remito_inmediato).not.toBeNull();
    expect(res.body.orden_entrega).not.toBeNull();
    expect(res.body.orden_entrega.tipo_entrega).toBe('ENVIO_DOMICILIO');
    expect(res.body.orden_entrega.direccion_envio).toBe('Av. Siempre Viva 742');
  });

  it('rechaza con 400 si queda algo pendiente y no se manda tipo_entrega', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar-mixta')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cliente_id: 1,
        items: [{ id_producto: 1, cantidad: 5, precio_unitario: 1000 }],
        pagos: [{ id_cuenta: 1, monto: 5000 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 si tipo_entrega es ENVIO_DOMICILIO sin dirección', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar-mixta')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cliente_id: 1,
        items: [{ id_producto: 1, cantidad: 5, precio_unitario: 1000 }],
        pagos: [{ id_cuenta: 1, monto: 5000 }],
        tipo_entrega: 'ENVIO_DOMICILIO',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 409 si no hay stock suficiente para reservar la porción pendiente', async () => {
    setQueryHandler(crearHandler({ stock: { cantidad: '2.000', cantidad_reservada: '0.000' } }));
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar-mixta')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cliente_id: 1,
        items: [{ id_producto: 1, cantidad: 5, precio_unitario: 1000 }],
        pagos: [{ id_cuenta: 1, monto: 5000 }],
        tipo_entrega: 'RETIRO_CLIENTE',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('STOCK_INSUFICIENTE');
  });

  it('rechaza con 400 si cantidad_retiro_inmediato supera la cantidad vendida', async () => {
    const token = crearToken();

    const res = await request(app)
      .post('/api/ventas/facturar-mixta')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cliente_id: 1,
        items: [{ id_producto: 1, cantidad: 5, precio_unitario: 1000, cantidad_retiro_inmediato: 6 }],
        pagos: [{ id_cuenta: 1, monto: 5000 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).post('/api/ventas/facturar-mixta').send({});
    expect(res.status).toBe(401);
  });
});
