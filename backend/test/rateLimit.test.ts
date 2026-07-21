import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { crearToken } from './helpers/auth';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

describe('Rate limiting', () => {
  describe('POST /api/auth/login', () => {
    beforeEach(() => {
      resetQueryLog();
      setQueryHandler((): MockQueryResult => ({ rows: [] })); // usuario inexistente -> 401, no importa para este test
    });

    it('rechaza con 429 después de superar el límite de intentos por IP', async () => {
      let ultimaRespuesta: request.Response | undefined;
      for (let i = 0; i < 11; i++) {
        ultimaRespuesta = await request(app).post('/api/auth/login').send({ usuario: 'x', password: 'y' });
      }

      expect(ultimaRespuesta!.status).toBe(429);
      expect(ultimaRespuesta!.body.error).toBe('DEMASIADOS_INTENTOS');
    });
  });

  describe('POST /api/ventas/facturar con x-supervisor-pin', () => {
    let PIN_HASH: string;

    beforeAll(async () => {
      PIN_HASH = await bcrypt.hash('4821', 4);
    });

    beforeEach(() => {
      resetQueryLog();
      setQueryHandler((sql): MockQueryResult => {
        if (/rol IN \('SUPERVISOR', 'ADMIN'\)/.test(sql)) {
          return { rows: [{ id_usuario: 99, nombre: 'Ana Supervisora', pin_autorizacion_hash: PIN_HASH }] };
        }
        throw new Error(`Query no esperada en el test: ${sql}`);
      });
    });

    it('rechaza con 429 después de superar el límite de intentos de PIN, sin afectar requests sin PIN', async () => {
      const token = crearToken();

      // Las requests sin header no cuentan para el límite del PIN (payload
      // inválido a propósito: lo único que importa es que no tiran 429).
      for (let i = 0; i < 20; i++) {
        const res = await request(app).post('/api/ventas/facturar').set('Authorization', `Bearer ${token}`).send({});
        expect(res.status).not.toBe(429);
      }

      let ultimaRespuesta: request.Response | undefined;
      for (let i = 0; i < 6; i++) {
        ultimaRespuesta = await request(app)
          .post('/api/ventas/facturar')
          .set('Authorization', `Bearer ${token}`)
          .set('x-supervisor-pin', '0000') // incorrecto a propósito: lo que se mide es el límite, no el resultado
          .send({});
      }

      expect(ultimaRespuesta!.status).toBe(429);
      expect(ultimaRespuesta!.body.error).toBe('DEMASIADOS_INTENTOS');
    });
  });
});
