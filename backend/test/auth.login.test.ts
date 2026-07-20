import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { resetQueryLog, setQueryHandler, type MockQueryResult } from './setup/pgMock';

const app = createApp();

let PASSWORD_HASH: string;

const USUARIO_FILA = {
  id_usuario: 7,
  nombre: 'Juan Vendedor',
  usuario: 'jvendedor',
  pin_autorizacion_hash: null,
  rol: 'VENDEDOR',
  id_sucursal: 1,
  activo: true,
};

beforeAll(async () => {
  PASSWORD_HASH = await bcrypt.hash('claveSegura123', 4);
});

beforeEach(() => {
  resetQueryLog();
});

function handlerConUsuario(usuario: typeof USUARIO_FILA | null) {
  return (sql: string): MockQueryResult => {
    if (/FROM usuarios WHERE usuario = \$1 AND activo = TRUE/.test(sql)) {
      return { rows: usuario ? [{ ...usuario, password_hash: PASSWORD_HASH }] : [] };
    }
    if (/FROM sucursales WHERE id_sucursal = \$1/.test(sql)) {
      return { rows: [{ id_sucursal: 1, nombre: 'Casa Central' }] };
    }
    throw new Error(`Query no esperada en el test: ${sql}`);
  };
}

describe('POST /api/auth/login', () => {
  it('devuelve un JWT válido con las credenciales correctas', async () => {
    setQueryHandler(handlerConUsuario(USUARIO_FILA));

    const res = await request(app).post('/api/auth/login').send({ usuario: 'jvendedor', password: 'claveSegura123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.user).toEqual({
      id_usuario: 7,
      usuario: 'jvendedor',
      nombre: 'Juan Vendedor',
      rol: 'VENDEDOR',
      id_sucursal: 1,
    });
    expect(res.body.sucursal.nombre).toBe('Casa Central');
  });

  it('rechaza con 401 una contraseña incorrecta', async () => {
    setQueryHandler(handlerConUsuario(USUARIO_FILA));

    const res = await request(app).post('/api/auth/login').send({ usuario: 'jvendedor', password: 'incorrecta' });

    expect(res.status).toBe(401);
  });

  it('rechaza con 401 un usuario inexistente, sin filtrar información', async () => {
    setQueryHandler(handlerConUsuario(null));

    const res = await request(app).post('/api/auth/login').send({ usuario: 'no-existe', password: 'lo-que-sea' });

    expect(res.status).toBe(401);
  });

  it('rechaza con 400 si falta usuario o password', async () => {
    const res = await request(app).post('/api/auth/login').send({ usuario: 'jvendedor' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYLOAD_INVALIDO');
  });

  it('rechaza con 400 si el usuario no tiene sucursal asignada', async () => {
    setQueryHandler(handlerConUsuario({ ...USUARIO_FILA, id_sucursal: null as unknown as number }));

    const res = await request(app).post('/api/auth/login').send({ usuario: 'jvendedor', password: 'claveSegura123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('USUARIO_SIN_SUCURSAL');
  });
});
