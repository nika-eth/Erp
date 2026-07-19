import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Falta la variable de entorno requerida: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  pg: {
    host: required('PGHOST', 'localhost'),
    port: Number(process.env.PGPORT ?? 5432),
    database: required('PGDATABASE', 'erp_metalurgica'),
    user: required('PGUSER', 'postgres'),
    password: required('PGPASSWORD', 'postgres'),
    poolMax: Number(process.env.PG_POOL_MAX ?? 10),
  },

  jwt: {
    secret: required('JWT_SECRET', 'dev-secret-cambiar'),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  },
} as const;
