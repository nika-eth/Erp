import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import {
  actualizarCotEnvio,
  asignarEnvio,
  listarCamiones,
  listarDocumentosPendientes,
  listarZonas,
  obtenerOcupacionDiaria,
} from '../services/logistica.service';
import type { ActualizarCotInput, AsignarEnvioInput } from '../types/domain';

export async function getZonas(_req: Request, res: Response): Promise<void> {
  res.json({ zonas: await listarZonas() });
}

export async function getCamiones(_req: Request, res: Response): Promise<void> {
  res.json({ camiones: await listarCamiones() });
}

export async function getDocumentosPendientes(_req: Request, res: Response): Promise<void> {
  res.json({ documentos: await listarDocumentosPendientes() });
}

/** GET /api/logistica/ocupacion?fecha=YYYY-MM-DD */
export async function getOcupacionDiaria(req: Request, res: Response): Promise<void> {
  const fecha = String(req.query.fecha ?? '');
  res.json({ fecha, camiones: await obtenerOcupacionDiaria(fecha) });
}

/**
 * POST /api/logistica/asignar-envio
 *
 * Endpoint crítico del módulo de logística: asigna un remito facturado a un
 * camión en una fecha de despacho, validando cupo de kilos y de casilleros
 * dentro de una única transacción. Devuelve 409 si no hay cupo.
 */
export async function postAsignarEnvio(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const input = req.body as AsignarEnvioInput;
  const envio = await asignarEnvio(input);

  res.status(201).json({ envio });
}

/**
 * PUT /api/logistica/envios/:id/cot
 *
 * Carga o corrige el Código de Operación de Traslado (COT, exigido por
 * ARBA) de un envío ya asignado a un camión.
 */
export async function putActualizarCot(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const input = req.body as ActualizarCotInput;
  const envio = await actualizarCotEnvio(Number(req.params.id), input);

  res.json({ envio });
}
