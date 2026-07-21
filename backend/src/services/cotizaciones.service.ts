import { pool } from '../config/db';
import { AppError } from '../utils/AppError';
import type { CargarCotizacionInput, Cotizacion, MonedaSoportada } from '../types/domain';

const MONEDAS_VALIDAS: MonedaSoportada[] = ['ARS', 'USD'];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

const COLUMNAS_COTIZACION = `id_cotizacion, moneda, fecha, valor, id_usuario_carga`;

/** Últimas cotizaciones cargadas, opcionalmente filtradas por moneda. */
export async function listarCotizaciones(moneda?: MonedaSoportada): Promise<Cotizacion[]> {
  if (moneda) {
    const { rows } = await pool.query<Cotizacion>(
      `SELECT ${COLUMNAS_COTIZACION} FROM cotizaciones WHERE moneda = $1 ORDER BY fecha DESC LIMIT 30`,
      [moneda],
    );
    return rows;
  }
  const { rows } = await pool.query<Cotizacion>(
    `SELECT ${COLUMNAS_COTIZACION} FROM cotizaciones ORDER BY fecha DESC LIMIT 30`,
  );
  return rows;
}

/** La cotización vigente para una moneda en una fecha puntual (usada por el futuro servicio de emisión de OP). */
export async function obtenerCotizacion(moneda: MonedaSoportada, fecha: string): Promise<Cotizacion> {
  const { rows } = await pool.query<Cotizacion>(
    `SELECT ${COLUMNAS_COTIZACION} FROM cotizaciones WHERE moneda = $1 AND fecha = $2`,
    [moneda, fecha],
  );
  const cotizacion = rows[0];
  if (!cotizacion) {
    throw AppError.notFound('COTIZACION_NO_ENCONTRADA', `No hay cotización cargada de ${moneda} para ${fecha}.`);
  }
  return cotizacion;
}

/**
 * Carga manual del tipo de cambio (sin integración externa todavía). Es un
 * upsert por (moneda, fecha): permite corregir la cotización del día varias
 * veces antes del cierre sin generar filas duplicadas.
 */
export async function cargarCotizacion(input: CargarCotizacionInput, id_usuario_carga: number): Promise<Cotizacion> {
  if (!MONEDAS_VALIDAS.includes(input.moneda)) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'moneda debe ser ARS o USD.');
  }
  if (!FECHA_RE.test(input.fecha ?? '')) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'fecha debe tener formato YYYY-MM-DD.');
  }
  if (typeof input.valor !== 'number' || Number.isNaN(input.valor) || input.valor <= 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'valor debe ser un número mayor a 0.');
  }

  const { rows } = await pool.query<Cotizacion>(
    `INSERT INTO cotizaciones (moneda, fecha, valor, id_usuario_carga)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (moneda, fecha) DO UPDATE SET valor = EXCLUDED.valor, id_usuario_carga = EXCLUDED.id_usuario_carga
     RETURNING ${COLUMNAS_COTIZACION}`,
    [input.moneda, input.fecha, input.valor, id_usuario_carga],
  );
  return rows[0];
}
