import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

const DOCUMENTO = {
  id_documento: 50,
  id_sucursal_origen: 1,
  nro_remito: 10,
  fecha: new Date().toISOString(),
  cliente_id: 1,
  total_neto: '1000.00',
  tipo_documento: 'FACTURA_A',
  id_zona: null,
  es_fiscal: true,
  tipo_comprobante: 'FACTURA_A',
  punto_venta: 1,
  nro_comprobante_afip: null,
  cae: null,
  cae_vencimiento: null,
  estado_afip: 'APROBADO',
  error_afip_mensaje: null,
  id_documento_origen_ci: null,
  estado_facturacion_interna: null,
  estado_despacho: 'PENDIENTE',
  items: [],
};

function crearHandler(opts: { documento?: typeof DOCUMENTO | null }) {
  const { documento = DOCUMENTO } = opts;

  return (sql: string, params: unknown[]): MockQueryResult => {
    if (/WHERE documentos\.id_documento = \$1/.test(sql)) {
      return { rows: documento ? [documento] : [] };
    }
    if (/FROM documentos d[\s\S]*JOIN clientes c/.test(sql)) {
      // Filtra localmente por id_sucursal_origen si el WHERE lo incluyó, para
      // simular el comportamiento real de la query parametrizada.
      const idSucursalParam = params.find((p) => typeof p === 'number' && sql.includes('id_sucursal_origen'));
      const rows = documento ? [documento] : [];
      return { rows: idSucursalParam !== undefined ? rows.filter((r) => r.id_sucursal_origen === idSucursalParam) : rows };
    }
    throw new Error(`Query no esperada: ${sql}`);
  };
}

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('GET /api/documentos/:id', () => {
  it('devuelve el documento si pertenece a la sucursal del VENDEDOR', async () => {
    const token = crearToken({ rol: 'VENDEDOR', id_sucursal: 1 });

    const res = await request(app).get('/api/documentos/50').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.documento.id_documento).toBe(50);
  });

  it('rechaza con 403 si un VENDEDOR pide un documento de otra sucursal', async () => {
    setQueryHandler(crearHandler({ documento: { ...DOCUMENTO, id_sucursal_origen: 2 } }));
    const token = crearToken({ rol: 'VENDEDOR', id_sucursal: 1 });

    const res = await request(app).get('/api/documentos/50').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('permite a un ADMIN ver un documento de otra sucursal', async () => {
    setQueryHandler(crearHandler({ documento: { ...DOCUMENTO, id_sucursal_origen: 2 } }));
    const token = crearToken({ rol: 'ADMIN', id_sucursal: 1 });

    const res = await request(app).get('/api/documentos/50').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('responde 404 si el documento no existe', async () => {
    setQueryHandler(crearHandler({ documento: null }));
    const token = crearToken({ rol: 'ADMIN' });

    const res = await request(app).get('/api/documentos/999').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).get('/api/documentos/50');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/documentos', () => {
  it('un VENDEDOR queda forzado a su propia sucursal aunque mande otro id_sucursal por query', async () => {
    setQueryHandler((sql, params): MockQueryResult => {
      expect(sql).toMatch(/d\.id_sucursal_origen = \$/);
      expect(params).toContain(1);
      expect(params).not.toContain(2);
      return { rows: [DOCUMENTO] };
    });
    const token = crearToken({ rol: 'VENDEDOR', id_sucursal: 1 });

    const res = await request(app).get('/api/documentos?id_sucursal=2').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('un ADMIN puede filtrar libremente por cualquier id_sucursal', async () => {
    setQueryHandler((_sql, params): MockQueryResult => {
      expect(params).toContain(2);
      return { rows: [] };
    });
    const token = crearToken({ rol: 'ADMIN', id_sucursal: 1 });

    const res = await request(app).get('/api/documentos?id_sucursal=2').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});
