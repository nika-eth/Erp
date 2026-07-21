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
    password: required('PGPASSWORD'),
    poolMax: Number(process.env.PG_POOL_MAX ?? 10),
    /** Neon (y la mayoría de los Postgres gestionados) exigen TLS. Ver PGSSL en .env.example. */
    ssl: process.env.PGSSL === 'true',
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  },

  /**
   * `cuit`/`certPath`/`keyPath` quedan vacíos por defecto a propósito (sin
   * `required()`): en un entorno sin certificado real, el servicio de AFIP
   * debe degradar a contingencia en cada venta en lugar de tirar abajo el
   * arranque del servidor. Ver `src/afip/wsaa.service.ts`.
   */
  afip: {
    entorno: (process.env.AFIP_ENTORNO === 'produccion' ? 'produccion' : 'homologacion') as
      | 'homologacion'
      | 'produccion',
    cuit: process.env.AFIP_CUIT ?? '',
    certPath: process.env.AFIP_CERT_PATH ?? '',
    keyPath: process.env.AFIP_KEY_PATH ?? '',
    puntoVenta: Number(process.env.AFIP_PUNTO_VENTA ?? 1),
    /** Punto de venta convencional para comprobantes internos (es_fiscal=false, Remito X). Nunca se usa para pedir CAE. */
    puntoVentaInterno: Number(process.env.AFIP_PUNTO_VENTA_INTERNO ?? 0),
    /** Si AFIP no responde dentro de este plazo, se cancela la solicitud y se activa contingencia. */
    timeoutMs: Number(process.env.AFIP_TIMEOUT_MS ?? 4000),
    wsaaUrl:
      process.env.AFIP_WSAA_URL ??
      (process.env.AFIP_ENTORNO === 'produccion'
        ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms'
        : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms'),
    wsfeUrl:
      process.env.AFIP_WSFE_URL ??
      (process.env.AFIP_ENTORNO === 'produccion'
        ? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx'
        : 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx'),
    workerIntervalMs: Number(process.env.AFIP_WORKER_INTERVAL_MS ?? 60_000),
    maxReintentos: Number(process.env.AFIP_MAX_REINTENTOS ?? 10),
  },
} as const;
