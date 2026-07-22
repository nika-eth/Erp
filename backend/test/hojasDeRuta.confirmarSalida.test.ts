import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { queryLog, resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const HOJA = {
  id_hoja_de_ruta: 5,
  id_camion: 1,
  chofer: 'Carlos Gomez',
  fecha_despacho: '2026-08-01',
  estado: 'BORRADOR',
  id_usuario_creo: 1,
  fecha_creacion: new Date().toISOString(),
  id_usuario_confirmo: null,
  fecha_confirmacion: null,
  motivo_anulacion: null,
  id_usuario_anulo: null,
  fecha_anulacion: null,
};

// Orden A: origen sucursal 1, despacho cruzado a sucursal 2.
// Orden B: origen sucursal 1, despacho local en sucursal 1.
const ORDENES: Record<number, Record<string, unknown>> = {
  20: { id_orden_entrega: 20, nro_orden: 'OE-1-000001', id_documento: 50, id_sucursal_origen: 1, cliente_id: 1, estado: 'PENDIENTE' },
  21: { id_orden_entrega: 21, nro_orden: 'OE-1-000002', id_documento: 51, id_sucursal_origen: 1, cliente_id: 1, estado: 'PENDIENTE' },
};
const DOCUMENTOS: Record<number, Record<string, unknown>> = {
  50: { id_documento: 50, cliente_id: 1, es_fiscal: true },
  51: { id_documento: 51, cliente_id: 1, es_fiscal: true },
};
const DETALLES: Record<number, Record<string, unknown>[]> = {
  20: [{ id_orden_entrega_detalle: 1, id_orden_entrega: 20, id_producto: 19, sku: 'AB1500', descripcion: 'Amoladora', cantidad: '5.000' }],
  21: [{ id_orden_entrega_detalle: 2, id_orden_entrega: 21, id_producto: 19, sku: 'AB1500', descripcion: 'Amoladora', cantidad: '3.000' }],
};
const RELACIONES = [
  { id_orden_entrega: 20, id_sucursal_despacho: 2 },
  { id_orden_entrega: 21, id_sucursal_despacho: 1 },
];

function crearHandler(opts: { hoja?: typeof HOJA | null; relaciones?: typeof RELACIONES; ordenes?: typeof ORDENES }) {
  const { hoja = HOJA, relaciones = RELACIONES, ordenes = ORDENES } = opts;
  let siguienteIdRemito = 300;

  return (sql: string, params: unknown[]): MockQueryResult => {
    if (/FROM hojas_de_ruta WHERE id_hoja_de_ruta = \$1 FOR UPDATE/.test(sql)) {
      return { rows: hoja ? [hoja] : [] };
    }
    if (/SELECT id_orden_entrega, id_sucursal_despacho FROM hoja_de_ruta_ordenes/.test(sql)) {
      return { rows: relaciones };
    }
    if (/FROM ordenes_entrega WHERE id_orden_entrega = \$1 FOR UPDATE/.test(sql)) {
      const orden = ordenes[params[0] as number];
      return { rows: orden ? [orden] : [] };
    }
    if (/SELECT id_documento, cliente_id, es_fiscal FROM documentos WHERE id_documento = \$1 FOR UPDATE/.test(sql)) {
      return { rows: [DOCUMENTOS[params[0] as number]] };
    }
    if (/FROM ordenes_entrega_detalles oed\s+JOIN productos p/.test(sql)) {
      const idOrden = params[0] as number;
      return { rows: DETALLES[idOrden] ?? [] };
    }
    if (/FROM stock_sucursal WHERE id_producto = \$1 AND id_sucursal = \$2 FOR UPDATE/.test(sql)) {
      return { rows: [{ cantidad: '100.000', cantidad_reservada: '0.000' }] };
    }
    if (/UPDATE stock_sucursal SET cantidad_reservada = cantidad_reservada -/.test(sql)) return { rows: [] };
    if (/UPDATE reservas_stock SET cantidad = cantidad -/.test(sql)) return { rows: [] };
    if (/UPDATE stock_sucursal SET cantidad = cantidad -/.test(sql)) return { rows: [] };
    if (/INSERT INTO stock_movements/.test(sql)) return { rows: [] };
    if (/SELECT cantidad, cantidad_despachada_total FROM documentos_detalles/.test(sql)) {
      return { rows: [{ cantidad: '10.000', cantidad_despachada_total: '0.000' }] };
    }
    if (/INSERT INTO remitos\s*\(/.test(sql)) {
      const [id_documento_origen, tipo_remito, cliente_id, id_sucursal] = params;
      return {
        rows: [
          {
            id_remito: siguienteIdRemito++,
            nro_remito: `${tipo_remito}-${id_sucursal}-000001`,
            id_documento_origen,
            tipo_remito,
            id_remito_origen_x: null,
            es_regularizacion_stock: false,
            estado: 'ENTREGADO',
            cliente_id,
            id_sucursal,
            id_camion: params[4],
            id_chofer: params[5],
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
    if (/SELECT COALESCE\(SUM\(cantidad\), 0\)/.test(sql)) return { rows: [{ cantidad_total: '5', despachado_total: '5' }] };
    if (/UPDATE documentos SET estado_despacho/.test(sql)) return { rows: [] };
    if (/FROM remitos_detalles rd/.test(sql)) {
      return { rows: [{ id_remito_detalle: 1, id_producto: 19, sku: 'AB1500', descripcion: 'Amoladora', cantidad_despachada: '5.000' }] };
    }
    if (/UPDATE ordenes_entrega SET estado = 'RETIRADA'/.test(sql)) {
      const idOrden = params[3] as number;
      return { rows: [{ ...ordenes[idOrden], estado: 'RETIRADA' }] };
    }
    if (/UPDATE hojas_de_ruta SET estado = 'EN_TRANSITO'/.test(sql)) {
      return { rows: [{ ...hoja, estado: 'EN_TRANSITO', id_usuario_confirmo: params[0], fecha_confirmacion: new Date().toISOString() }] };
    }
    if (/FROM hoja_de_ruta_ordenes hro\s+JOIN ordenes_entrega oe/.test(sql)) {
      return {
        rows: relaciones.map((r, i) => ({
          id_hoja_de_ruta_orden: i + 1,
          id_hoja_de_ruta: hoja!.id_hoja_de_ruta,
          id_orden_entrega: r.id_orden_entrega,
          nro_orden: (ordenes[r.id_orden_entrega] as { nro_orden: string }).nro_orden,
          cliente: 'Cliente Test',
          id_sucursal_despacho: r.id_sucursal_despacho,
          casilleros_ocupados: 1,
          kilos_asignados: '50.00',
        })),
      };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('POST /api/hojas-de-ruta/:id/confirmar-salida', () => {
  it('confirma la salida y despacha ambas órdenes en una sola transacción (una local, una cruzada)', async () => {
    const token = crearToken();

    const res = await request(app).post('/api/hojas-de-ruta/5/confirmar-salida').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.hoja_de_ruta.estado).toBe('EN_TRANSITO');
    expect(res.body.hoja_de_ruta.ordenes).toHaveLength(2);
    expect(queryLog.some((q) => q.params.includes('DESPACHO_CRUZADO'))).toBe(true);
    expect(queryLog.some((q) => q.params.includes('DESPACHO_LOCAL'))).toBe(true);
    expect(queryLog.filter((q) => /INSERT INTO remitos\s*\(/.test(q.sql))).toHaveLength(2);
  });

  it('revierte todo el viaje si una orden ya no está pendiente (anulada por otra vía mientras se armaba)', async () => {
    setQueryHandler(crearHandler({ ordenes: { ...ORDENES, 21: { ...ORDENES[21], estado: 'ANULADA' } } }));
    const token = crearToken();

    const res = await request(app).post('/api/hojas-de-ruta/5/confirmar-salida').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ORDEN_ENTREGA_NO_PENDIENTE');
  });

  it('rechaza con 400 si la hoja no tiene ninguna orden asignada', async () => {
    setQueryHandler(crearHandler({ relaciones: [] }));
    const token = crearToken();

    const res = await request(app).post('/api/hojas-de-ruta/5/confirmar-salida').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('HOJA_SIN_ORDENES');
  });

  it('rechaza con 400 si la hoja ya fue confirmada', async () => {
    setQueryHandler(crearHandler({ hoja: { ...HOJA, estado: 'EN_TRANSITO' } }));
    const token = crearToken();

    const res = await request(app).post('/api/hojas-de-ruta/5/confirmar-salida').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('HOJA_YA_EN_TRANSITO');
  });

  it('rechaza con 400 si la hoja está anulada', async () => {
    setQueryHandler(crearHandler({ hoja: { ...HOJA, estado: 'ANULADA' } }));
    const token = crearToken();

    const res = await request(app).post('/api/hojas-de-ruta/5/confirmar-salida').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('HOJA_ANULADA');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).post('/api/hojas-de-ruta/5/confirmar-salida');
    expect(res.status).toBe(401);
  });
});
