import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { emitirRecibo } from '../services/recibos.service';
import type { EmitirReciboInput } from '../types/domain';

/**
 * POST /api/recibos/emitir
 *
 * Emite un recibo de cobranza: cabecera + desglose de medios de pago +
 * HABER en cuenta_corriente. `id_sucursal` e `id_usuario` salen de
 * `req.user` (firmado en el JWT), no del body.
 */
export async function postEmitirRecibo(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const input = req.body as EmitirReciboInput;
  const resultado = await emitirRecibo({ id_sucursal: req.user.id_sucursal, id_usuario: req.user.id_usuario }, input);

  res.status(201).json(resultado);
}
