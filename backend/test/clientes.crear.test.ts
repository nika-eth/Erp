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

describe('POST /api/clientes', () => {
  it('crea un cliente con CUIT + Responsable Inscripto y devuelve 201', async () => {
    setQueryHandler((sql, params): MockQueryResult => {
      if (/INSERT INTO clientes/.test(sql)) {
        const [nombre, tipo_documento, numero_documento, condicion_iva, limite_credito, id_zona] = params;
        return {
          rows: [
            {
              id_cliente: 10,
              nombre,
              tipo_documento,
              numero_documento,
              condicion_iva,
              limite_credito: String(limite_credito),
              id_zona,
              direccion: null,
              telefono: null,
              email: null,
            },
          ],
        };
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .post('/api/clientes')
      .set('Authorization', `Bearer ${crearToken()}`)
      .send({
        nombre: 'Cliente Nuevo SA',
        tipo_documento: 'CUIT',
        numero_documento: CUIT_VALIDO,
        condicion_iva: 'RESPONSABLE_INSCRIPTO',
        limite_credito: 50000,
      });

    expect(res.status).toBe(201);
    expect(res.body.cliente).toMatchObject({
      id_cliente: 10,
      nombre: 'Cliente Nuevo SA',
      tipo_documento: 'CUIT',
      numero_documento: CUIT_VALIDO,
      condicion_iva: 'RESPONSABLE_INSCRIPTO',
      limite_credito: '50000',
    });
  });

  it('crea un cliente con DNI (siempre Consumidor Final) y limite_credito por defecto en 0', async () => {
    setQueryHandler((sql, params): MockQueryResult => {
      if (/INSERT INTO clientes/.test(sql)) {
        const [nombre, tipo_documento, numero_documento, condicion_iva, limite_credito, id_zona] = params;
        expect(limite_credito).toBe(0);
        return {
          rows: [
            { id_cliente: 11, nombre, tipo_documento, numero_documento, condicion_iva, limite_credito: '0', id_zona, direccion: null, telefono: null, email: null },
          ],
        };
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .post('/api/clientes')
      .set('Authorization', `Bearer ${crearToken()}`)
      .send({ nombre: 'Juan Perez', tipo_documento: 'DNI', numero_documento: '30123456', condicion_iva: 'CONSUMIDOR_FINAL' });

    expect(res.status).toBe(201);
    expect(res.body.cliente.condicion_iva).toBe('CONSUMIDOR_FINAL');
  });

  it('rechaza con 400 si falta el nombre', async () => {
    const res = await request(app)
      .post('/api/clientes')
      .set('Authorization', `Bearer ${crearToken()}`)
      .send({ nombre: '  ', tipo_documento: 'CUIT', numero_documento: CUIT_VALIDO, condicion_iva: 'RESPONSABLE_INSCRIPTO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 si el DNI no tiene 7 u 8 dígitos', async () => {
    const res = await request(app)
      .post('/api/clientes')
      .set('Authorization', `Bearer ${crearToken()}`)
      .send({ nombre: 'Cliente', tipo_documento: 'DNI', numero_documento: '123', condicion_iva: 'CONSUMIDOR_FINAL' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 si el CUIT no tiene 11 dígitos', async () => {
    const res = await request(app)
      .post('/api/clientes')
      .set('Authorization', `Bearer ${crearToken()}`)
      .send({ nombre: 'Cliente', tipo_documento: 'CUIT', numero_documento: '123', condicion_iva: 'RESPONSABLE_INSCRIPTO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 (CUIT_INVALIDO) si el dígito verificador del CUIT no coincide', async () => {
    const res = await request(app)
      .post('/api/clientes')
      .set('Authorization', `Bearer ${crearToken()}`)
      .send({ nombre: 'Cliente', tipo_documento: 'CUIT', numero_documento: '20111111111', condicion_iva: 'RESPONSABLE_INSCRIPTO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CUIT_INVALIDO');
  });

  it('rechaza con 400 si un DNI viene con una condición IVA distinta de Consumidor Final', async () => {
    const res = await request(app)
      .post('/api/clientes')
      .set('Authorization', `Bearer ${crearToken()}`)
      .send({ nombre: 'Cliente', tipo_documento: 'DNI', numero_documento: '30123456', condicion_iva: 'MONOTRIBUTO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CONDICION_IVA_INVALIDA');
  });

  it('rechaza con 400 si un CUIT viene con condición IVA Consumidor Final', async () => {
    const res = await request(app)
      .post('/api/clientes')
      .set('Authorization', `Bearer ${crearToken()}`)
      .send({ nombre: 'Cliente', tipo_documento: 'CUIT', numero_documento: CUIT_VALIDO, condicion_iva: 'CONSUMIDOR_FINAL' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CONDICION_IVA_INVALIDA');
  });

  it('rechaza con 400 si limite_credito es negativo', async () => {
    const res = await request(app)
      .post('/api/clientes')
      .set('Authorization', `Bearer ${crearToken()}`)
      .send({
        nombre: 'Cliente',
        tipo_documento: 'CUIT',
        numero_documento: CUIT_VALIDO,
        condicion_iva: 'RESPONSABLE_INSCRIPTO',
        limite_credito: -100,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 409 si el número de documento ya está registrado', async () => {
    setQueryHandler((sql): MockQueryResult => {
      if (/INSERT INTO clientes/.test(sql)) {
        const err = new Error('duplicate key value violates unique constraint "clientes_numero_documento_key"') as Error & {
          code: string;
        };
        err.code = '23505';
        throw err;
      }
      throw new Error(`Query no esperada: ${sql}`);
    });

    const res = await request(app)
      .post('/api/clientes')
      .set('Authorization', `Bearer ${crearToken()}`)
      .send({ nombre: 'Cliente Repetido', tipo_documento: 'CUIT', numero_documento: CUIT_VALIDO, condicion_iva: 'RESPONSABLE_INSCRIPTO' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('REGISTRO_DUPLICADO');
  });

  it('rechaza con 401 sin token de sesión', async () => {
    const res = await request(app)
      .post('/api/clientes')
      .send({ nombre: 'Cliente', tipo_documento: 'CUIT', numero_documento: CUIT_VALIDO, condicion_iva: 'RESPONSABLE_INSCRIPTO' });

    expect(res.status).toBe(401);
  });
});
