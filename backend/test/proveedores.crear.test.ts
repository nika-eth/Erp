import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

// CUIT con dígito verificador válido (Módulo 11) — ver identificacion.utils.test.ts.
const CUIT_VALIDO = '20111111112';

beforeEach(() => {
  resetQueryLog();
});

describe('POST /api/proveedores', () => {
  it('crea un proveedor con CUIT + Responsable Inscripto y devuelve 201', async () => {
    setQueryHandler((sql, params): MockQueryResult => {
      if (/INSERT INTO proveedores/.test(sql)) {
        const [nombre, tipo_documento, numero_documento, condicion_iva] = params;
        return {
          rows: [
            {
              id_proveedor: 1,
              nombre,
              tipo_documento,
              numero_documento,
              condicion_iva,
              direccion: null,
              telefono: null,
              email: null,
              activo: true,
            },
          ],
        };
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .post('/api/proveedores')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({
        nombre: 'Proveedor Metales SA',
        tipo_documento: 'CUIT',
        numero_documento: CUIT_VALIDO,
        condicion_iva: 'RESPONSABLE_INSCRIPTO',
      });

    expect(res.status).toBe(201);
    expect(res.body.proveedor).toMatchObject({
      id_proveedor: 1,
      nombre: 'Proveedor Metales SA',
      tipo_documento: 'CUIT',
      numero_documento: CUIT_VALIDO,
      condicion_iva: 'RESPONSABLE_INSCRIPTO',
    });
  });

  it('rechaza con 400 (CUIT_INVALIDO) si el dígito verificador no coincide', async () => {
    const res = await request(app)
      .post('/api/proveedores')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ nombre: 'Proveedor', tipo_documento: 'CUIT', numero_documento: '20111111111', condicion_iva: 'RESPONSABLE_INSCRIPTO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CUIT_INVALIDO');
  });

  it('rechaza con 400 si condicion_iva es CONSUMIDOR_FINAL (no existe para proveedores)', async () => {
    const res = await request(app)
      .post('/api/proveedores')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ nombre: 'Proveedor', tipo_documento: 'CUIT', numero_documento: CUIT_VALIDO, condicion_iva: 'CONSUMIDOR_FINAL' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CONDICION_IVA_INVALIDA');
  });

  it('rechaza con 400 si falta el nombre', async () => {
    const res = await request(app)
      .post('/api/proveedores')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ nombre: '   ', tipo_documento: 'CUIT', numero_documento: CUIT_VALIDO, condicion_iva: 'RESPONSABLE_INSCRIPTO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 409 si el número de documento ya está registrado', async () => {
    setQueryHandler((sql): MockQueryResult => {
      if (/INSERT INTO proveedores/.test(sql)) {
        const err = new Error('duplicate key value violates unique constraint "proveedores_tipo_documento_numero_documento_key"') as Error & {
          code: string;
        };
        err.code = '23505';
        throw err;
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .post('/api/proveedores')
      .set('Authorization', `Bearer ${crearToken({ rol: 'ADMIN' })}`)
      .send({ nombre: 'Proveedor Repetido', tipo_documento: 'CUIT', numero_documento: CUIT_VALIDO, condicion_iva: 'RESPONSABLE_INSCRIPTO' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('REGISTRO_DUPLICADO');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app)
      .post('/api/proveedores')
      .send({ nombre: 'Proveedor', tipo_documento: 'CUIT', numero_documento: CUIT_VALIDO, condicion_iva: 'RESPONSABLE_INSCRIPTO' });

    expect(res.status).toBe(401);
  });

  it('rechaza con 403 a un VENDEDOR (el módulo de Cuentas por Pagar es sólo ADMIN/SUPERVISOR)', async () => {
    const res = await request(app)
      .post('/api/proveedores')
      .set('Authorization', `Bearer ${crearToken({ rol: 'VENDEDOR' })}`)
      .send({ nombre: 'Proveedor', tipo_documento: 'CUIT', numero_documento: CUIT_VALIDO, condicion_iva: 'RESPONSABLE_INSCRIPTO' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACCESO_DENEGADO');
  });

  it('permite a un SUPERVISOR crear un proveedor', async () => {
    setQueryHandler((sql, params): MockQueryResult => {
      if (/INSERT INTO proveedores/.test(sql)) {
        const [nombre, tipo_documento, numero_documento, condicion_iva] = params;
        return {
          rows: [{ id_proveedor: 2, nombre, tipo_documento, numero_documento, condicion_iva, direccion: null, telefono: null, email: null, activo: true }],
        };
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .post('/api/proveedores')
      .set('Authorization', `Bearer ${crearToken({ rol: 'SUPERVISOR' })}`)
      .send({ nombre: 'Proveedor', tipo_documento: 'CUIT', numero_documento: CUIT_VALIDO, condicion_iva: 'MONOTRIBUTO' });

    expect(res.status).toBe(201);
  });
});
