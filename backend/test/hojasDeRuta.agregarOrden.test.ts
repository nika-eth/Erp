import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

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

const CAMION = { id_camion: 1, patente: 'AB123CD', chofer: 'Carlos Gomez', capacidad_casilleros: 10, capacidad_kilos_max: '5000.00' };
const ORDEN = { id_orden_entrega: 20, id_documento: 50, estado: 'PENDIENTE' };
const ZONA = { id_zona: 1, nombre: 'Zona Cercana', casilleros_requeridos: 1 };

function crearHandler(opts: {
  hoja?: typeof HOJA | null;
  camion?: typeof CAMION | null;
  orden?: typeof ORDEN | null;
  yaAsignada?: boolean;
  idZona?: number | null;
  zona?: typeof ZONA | null;
  kilosOrden?: number;
  casillerosUsados?: number;
  kilosUsados?: number;
}) {
  const {
    hoja = HOJA,
    camion = CAMION,
    orden = ORDEN,
    yaAsignada = false,
    idZona = ZONA.id_zona,
    zona = ZONA,
    kilosOrden = 100,
    casillerosUsados = 0,
    kilosUsados = 0,
  } = opts;

  return (sql: string): MockQueryResult => {
    if (/FROM hojas_de_ruta WHERE id_hoja_de_ruta = \$1 FOR UPDATE/.test(sql)) {
      return { rows: hoja ? [hoja] : [] };
    }
    if (/FROM camiones WHERE id_camion = \$1 FOR UPDATE/.test(sql)) {
      return { rows: camion ? [camion] : [] };
    }
    if (/FROM ordenes_entrega WHERE nro_orden = \$1 FOR UPDATE/.test(sql)) {
      return { rows: orden ? [orden] : [] };
    }
    if (/FROM hoja_de_ruta_ordenes hro\s+JOIN hojas_de_ruta hr/.test(sql)) {
      return { rows: yaAsignada ? [{ id_hoja_de_ruta: 999 }] : [] };
    }
    if (/SELECT id_zona FROM documentos WHERE id_documento = \$1/.test(sql)) {
      return { rows: [{ id_zona: idZona }] };
    }
    if (/FROM zonas WHERE id_zona = \$1/.test(sql)) {
      return { rows: zona ? [zona] : [] };
    }
    if (/SELECT COALESCE\(SUM\(oed\.cantidad \* p\.peso_teorico_kg\), 0\) AS kilos_totales/.test(sql)) {
      return { rows: [{ kilos_totales: String(kilosOrden) }] };
    }
    if (/SELECT COALESCE\(SUM\(casilleros_ocupados\)/.test(sql)) {
      return { rows: [{ casilleros_usados: String(casillerosUsados), kilos_usados: String(kilosUsados) }] };
    }
    if (/INSERT INTO hoja_de_ruta_ordenes/.test(sql)) return { rows: [] };
    if (/FROM hoja_de_ruta_ordenes hro\s+JOIN ordenes_entrega oe/.test(sql)) {
      return { rows: [{ id_hoja_de_ruta_orden: 1, id_hoja_de_ruta: hoja!.id_hoja_de_ruta, id_orden_entrega: orden!.id_orden_entrega, nro_orden: 'OE-1-000001', cliente: 'Cliente Test', id_sucursal_despacho: 1, casilleros_ocupados: 1, kilos_asignados: '100.00' }] };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

const PAYLOAD_VALIDO = { nro_orden: 'OE-1-000001', id_sucursal_despacho: 1 };

beforeEach(() => {
  resetQueryLog();
  setQueryHandler(crearHandler({}));
});

describe('POST /api/hojas-de-ruta/:id/ordenes', () => {
  it('agrega una orden pendiente a la hoja de ruta', async () => {
    const token = crearToken({ id_sucursal: 1 });

    const res = await request(app).post('/api/hojas-de-ruta/5/ordenes').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(201);
    expect(res.body.hoja_de_ruta.ordenes).toHaveLength(1);
  });

  it('rechaza con 400 si la hoja ya no está en borrador', async () => {
    setQueryHandler(crearHandler({ hoja: { ...HOJA, estado: 'EN_TRANSITO' } }));
    const token = crearToken({ id_sucursal: 1 });

    const res = await request(app).post('/api/hojas-de-ruta/5/ordenes').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('HOJA_NO_EDITABLE');
  });

  it('rechaza con 409 si la orden ya no está pendiente', async () => {
    setQueryHandler(crearHandler({ orden: { ...ORDEN, estado: 'RETIRADA' } }));
    const token = crearToken({ id_sucursal: 1 });

    const res = await request(app).post('/api/hojas-de-ruta/5/ordenes').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ORDEN_NO_DISPONIBLE');
  });

  it('rechaza con 409 si la orden ya está asignada a otro viaje', async () => {
    setQueryHandler(crearHandler({ yaAsignada: true }));
    const token = crearToken({ id_sucursal: 1 });

    const res = await request(app).post('/api/hojas-de-ruta/5/ordenes').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ORDEN_YA_ASIGNADA');
  });

  it('rechaza con 409 cuando el camión supera la capacidad de kilos del viaje', async () => {
    setQueryHandler(crearHandler({ kilosOrden: 100, kilosUsados: 4950 }));
    const token = crearToken({ id_sucursal: 1 });

    const res = await request(app).post('/api/hojas-de-ruta/5/ordenes').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CAPACIDAD_KILOS_EXCEDIDA');
  });

  it('rechaza con 409 cuando el camión supera la capacidad de casilleros del viaje', async () => {
    setQueryHandler(crearHandler({ zona: { id_zona: 3, nombre: 'Zona Lejana', casilleros_requeridos: 3 }, casillerosUsados: 8 }));
    const token = crearToken({ id_sucursal: 1 });

    const res = await request(app).post('/api/hojas-de-ruta/5/ordenes').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CAPACIDAD_CASILLEROS_EXCEDIDA');
  });

  it('rechaza con 400 si el cliente de la orden no tiene zona', async () => {
    setQueryHandler(crearHandler({ idZona: null }));
    const token = crearToken({ id_sucursal: 1 });

    const res = await request(app).post('/api/hojas-de-ruta/5/ordenes').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CLIENTE_SIN_ZONA');
  });

  it('rechaza con 403 si un VENDEDOR elige una sucursal de despacho que no es la suya', async () => {
    const token = crearToken({ rol: 'VENDEDOR', id_sucursal: 2 });

    const res = await request(app).post('/api/hojas-de-ruta/5/ordenes').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(403);
  });

  it('rechaza con 404 si la hoja de ruta no existe', async () => {
    setQueryHandler(crearHandler({ hoja: null }));
    const token = crearToken({ id_sucursal: 1 });

    const res = await request(app).post('/api/hojas-de-ruta/999/ordenes').set('Authorization', `Bearer ${token}`).send(PAYLOAD_VALIDO);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('HOJA_DE_RUTA_NO_ENCONTRADA');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app).post('/api/hojas-de-ruta/5/ordenes').send(PAYLOAD_VALIDO);
    expect(res.status).toBe(401);
  });
});
