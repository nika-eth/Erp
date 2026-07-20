import type { Request, Response } from 'express';
import { reintentarTareaAhora } from '../afip/contingencia.worker';
import { obtenerEstadoServicio } from '../afip/cola.repository';
import { AppError } from '../utils/AppError';

/** GET /api/afip/estado — indicador global del Header (verde/amarillo + cantidad de tareas en cola). */
export async function getEstadoAfip(_req: Request, res: Response): Promise<void> {
  const estado = await obtenerEstadoServicio();
  res.json(estado);
}

/**
 * POST /api/afip/reintentar/:idTarea
 *
 * Fuerza el reintento de una tarea de la cola fuera del ciclo del worker
 * (ej. el supervisor sabe que AFIP ya volvió y no quiere esperar al próximo
 * `AFIP_WORKER_INTERVAL_MS`). Restringido a ADMIN/SUPERVISOR vía
 * `requireRole` en las rutas.
 */
export async function postReintentarTarea(req: Request, res: Response): Promise<void> {
  const idTarea = Number(req.params.idTarea);
  if (!Number.isInteger(idTarea) || idTarea <= 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'idTarea debe ser un entero positivo.');
  }
  await reintentarTareaAhora(idTarea);
  res.status(200).json({ ok: true });
}
