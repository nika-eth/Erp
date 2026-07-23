import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import {
  anularOrdenEntrega,
  buscarOrdenEntregaPorNro,
  editarTipoEntregaOrden,
  retirarOrdenEntrega,
} from '../services/ordenesEntrega.service';
import type { AnularOrdenEntregaInput, EditarTipoEntregaOrdenInput } from '../types/domain';

/** GET /api/ordenes-entrega/:nro_orden */
export async function getOrdenEntregaPorNro(req: Request, res: Response): Promise<void> {
  const orden = await buscarOrdenEntregaPorNro(req.params.nro_orden);
  res.json({ orden_entrega: orden });
}

/**
 * POST /api/ordenes-entrega/:nro_orden/retirar
 *
 * Retiro todo-o-nada de una Orden de Entrega Pendiente, desde la sucursal
 * del operador que la ejecuta (no necesariamente la de origen).
 */
export async function postRetirarOrdenEntrega(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const orden = await retirarOrdenEntrega(req.params.nro_orden, {
    id_sucursal: req.user.id_sucursal,
    id_usuario: req.user.id_usuario,
  });

  res.json({ orden_entrega: orden });
}

/**
 * PUT /api/ordenes-entrega/:nro_orden/tipo-entrega
 *
 * Edita la intención de cumplimiento de una orden pendiente (caso "flete
 * pagado aparte": pasa de retiro en mostrador a envío a domicilio, o
 * viceversa).
 */
export async function putEditarTipoEntregaOrdenEntrega(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const input = req.body as EditarTipoEntregaOrdenInput;
  const orden = await editarTipoEntregaOrden(req.params.nro_orden, input, {
    rol: req.user.rol,
    id_sucursal: req.user.id_sucursal,
    id_usuario: req.user.id_usuario,
  });

  res.json({ orden_entrega: orden });
}

/** POST /api/ordenes-entrega/:nro_orden/anular */
export async function postAnularOrdenEntrega(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const input = req.body as AnularOrdenEntregaInput;
  const orden = await anularOrdenEntrega(
    req.params.nro_orden,
    { rol: req.user.rol, id_sucursal: req.user.id_sucursal, id_usuario: req.user.id_usuario },
    input,
  );

  res.json({ orden_entrega: orden });
}
