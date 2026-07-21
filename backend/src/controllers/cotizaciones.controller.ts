import type { Request, Response } from 'express';
import { cargarCotizacion, listarCotizaciones, obtenerCotizacion } from '../services/cotizaciones.service';
import { AppError } from '../utils/AppError';
import type { CargarCotizacionInput, MonedaSoportada } from '../types/domain';

/** GET /api/cotizaciones?moneda=USD */
export async function getCotizaciones(req: Request, res: Response): Promise<void> {
  const moneda = req.query.moneda as MonedaSoportada | undefined;
  const cotizaciones = await listarCotizaciones(moneda);
  res.json({ cotizaciones });
}

/** GET /api/cotizaciones/:moneda/:fecha */
export async function getCotizacionPorFecha(req: Request, res: Response): Promise<void> {
  const moneda = req.params.moneda as MonedaSoportada;
  const cotizacion = await obtenerCotizacion(moneda, req.params.fecha);
  res.json({ cotizacion });
}

/** POST /api/cotizaciones — carga manual diaria (upsert por moneda+fecha). */
export async function postCargarCotizacion(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  const input = req.body as CargarCotizacionInput;
  const cotizacion = await cargarCotizacion(input, req.user.id_usuario);
  res.status(201).json({ cotizacion });
}
