import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { queryLog, resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const PRODUCTO = { id_producto: 1, sku: 'AB1500', descripcion: 'Amoladora' };

function ordenPendiente(overrides: Partial<{ id_sucursal_origen: number; estado: string }> = {}) {
  return {
    id_orden_entrega: 10,
    nro_orden: 'OE-1-000001',
    id_documento: 50,
    id_sucursal_origen: overrides.id_sucursal_origen ?? 1,
    cliente_id: 1,
    estado: overrides.estado ?? 'PENDIENTE',
    fecha_creacion: new Date().toISOString(),
    id_usuario_creo: 1,
    id_sucursal_retiro: null,
    id_usuario_retiro: null,
    fecha_retiro: null,
    id_remito_retiro: null,
    motivo_anulacion: null,
    id_usuario_anulo: null,
    fecha_anulacion: null,
  };
}

const DETALLE = { id_orden_entrega_detalle: 1, id_orden_entrega: 10, id_producto: PRODUCTO.id_producto, sku: PRODUCTO.sku, descripcion: PRODUCTO.descripcion, cantidad: '5.000' };

function crearHandler(opts: { orden?: ReturnType<typeof ordenPendiente> | null }) {
  const { orden = ordenPendiente() } = opts;

  return (sql: string): MockQueryResult => {
    if (/FROM ordenes_entrega WHERE nro_orden = \$1 FOR UPDATE/.test(sql)) {
      return { rows: orden ? [orden] : [] };
    }
    if (/FROM documentos WHERE id_documento = \$1 FOR UPDATE/.test(sql)) {
      return { rows: [{ id_documento: orden!.id_documento, cliente_id: orden!.cliente_id, es_fiscal: true }] };
    }
    if (/FROM ordenes_entrega_detalles oed/.test(sql)) {
      return { rows: [DETALLE] };
    }
    if (/SELECT cantidad, cantidad_despachada_total FROM documentos_detalles/.test(sql)) {
      return { rows: [{ cantidad: '10.000', cantidad_despachada_total: '0.000' }] };
    }
    if (/FROM stock_sucursal WHERE id_producto = \$1 AND id_sucursal = \$2 FOR UPDATE/.test(sql)) {
      return { rows: [{ cantidad: '50.000', cantidad_reservada: '0.000' }] };
    }
    if (/UPDATE stock_sucursal SET cantidad_reservada = cantidad_reservada -/.test(sql)) return { rows: [] };
    if (/UPDATE reservas_stock SET cantidad = cantidad -/.test(sql)) return { rows: [] };
    if (/UPDATE stock_sucursal SET cantidad = cantidad -/.test(sql)) return { rows: [] };
    if (/INSERT INTO stock_movements/.test(sql)) return { rows: [] };
    if (/INSERT INTO remitos\s*\(/.test(sql)) {
      return {
        rows: [
          {
            id_remito: 200,
            nro_remito: 'R-2-000001',
            id_documento_origen: orden!.id_documento,
            tipo_remito: 'R',
            id_remito_origen_x: null,
            es_regularizacion_stock: false,
            estado: 'ENTREGADO',
            cliente_id: orden!.cliente_id,
            id_sucursal: 2,
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
    if (/INSERT INTO remitos_detalles/.test(sql)) return { rows: [] };
    if (/UPDATE documentos_detalles SET cantidad_despachada_total = cantidad_despachada_total \+/.test(sql)) return { rows: [] };
    if (/SELECT COALESCE\(SUM\(cantidad\), 0\)/.test(sql)) return { rows: [{ cantidad_total: '10', despachado_total: '5' }] };
    if (/UPDATE documentos SET estado_despacho/.test(sql)) return { rows: [] };
    if (/FROM remitos_detalles rd/.test(sql)) {
      return { rows: [{ id_remito_detalle: 1, id_producto: PRODUCTO.id_producto, sku: PRODUCTO.sku, descripcion: PRODUCTO.descripcion, cantidad_despachada: '5.000' }] };
    }
    if (/UPDATE ordenes_entrega SET estado = 'RETIRADA'/.test(sql)) {
      return { rows: [{ ...orden, estado: 'RETIRADA', id_sucursal_retiro: 2, id_usuario_retiro: 1, fecha_retiro: new Date().toISOString(), id_remito_retiro: 200 }] };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('POST /api/ordenes-entrega/:nro_orden/retirar', () => {
  it('retira una orden desde otra sucursal: libera la reserva de origen y despacha en la sucursal de retiro', async () => {
    const token = crearToken({ id_sucursal: 2 });

    const res = await request(app).post('/api/ordenes-entrega/OE-1-000001/retirar').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.orden_entrega.estado).toBe('RETIRADA');
    expect(res.body.orden_entrega.id_sucursal_retiro).toBe(2);
    expect(queryLog.some((q) => q.sql.includes('RESERVA_LIBERADA'))).toBe(true);
    expect(queryLog.some((q) => q.params.includes('DESPACHO_CRUZADO'))).toBe(true);
  });

  it('retira una orden en la misma sucursal de origen', async () => {
    const token = crearToken({ id_sucursal: 1 });

    const res = await request(app).post('/api/ordenes-entrega/OE-1-000001/retirar').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('responde 404 si la orden no existe', async () => {
    setQueryHandler(crearHandler({ orden: null }));
    const token = crearToken();

    const res = await request(app).post('/api/ordenes-entrega/OE-1-999999/retirar').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ORDEN_ENTREGA_NO_ENCONTRADA');
  });

  it('rechaza con 400 si la orden ya fue retirada', async () => {
    setQueryHandler(crearHandler({ orden: ordenPendiente({ estado: 'RETIRADA' }) }));
    const token = crearToken();

    const res = await request(app).post('/api/ordenes-entrega/OE-1-000001/retirar').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ORDEN_YA_RETIRADA');
  });

  it('rechaza con 400 si la orden fue anulada', async () => {
    setQueryHandler(crearHandler({ orden: ordenPendiente({ estado: 'ANULADA' }) }));
    const token = crearToken();

    const res = await request(app).post('/api/ordenes-entrega/OE-1-000001/retirar').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ORDEN_ANULADA');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).post('/api/ordenes-entrega/OE-1-000001/retirar');
    expect(res.status).toBe(401);
  });
});
