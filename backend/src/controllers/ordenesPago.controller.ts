import type { Request, Response } from 'express';
import { anularOrdenPago, buscarOrdenesPago, buscarOrdenPagoPorId, emitirOrdenPago } from '../services/ordenesPago.service';
import { AppError } from '../utils/AppError';
import type { AnularOrdenPagoInput, EmitirOrdenPagoInput } from '../types/domain';

/** GET /api/ordenes-pago?id_proveedor=1 */
export async function getOrdenesPago(req: Request, res: Response): Promise<void> {
  const idProveedor = req.query.id_proveedor !== undefined ? Number(req.query.id_proveedor) : undefined;
  const ordenesPago = await buscarOrdenesPago(idProveedor);
  res.json({ ordenesPago });
}

/** GET /api/ordenes-pago/:id */
export async function getOrdenPagoPorId(req: Request, res: Response): Promise<void> {
  const ordenPago = await buscarOrdenPagoPorId(Number(req.params.id));
  res.json({ ordenPago });
}

/** POST /api/ordenes-pago */
export async function postEmitirOrdenPago(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  const input = req.body as EmitirOrdenPagoInput;
  const resultado = await emitirOrdenPago(input, { id_sucursal: req.user.id_sucursal, id_usuario: req.user.id_usuario });
  res.status(201).json(resultado);
}

/** POST /api/ordenes-pago/:id/anular */
export async function postAnularOrdenPago(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  const input = req.body as AnularOrdenPagoInput;
  const ordenPago = await anularOrdenPago(Number(req.params.id), { id_usuario: req.user.id_usuario }, input);
  res.json({ ordenPago });
}
