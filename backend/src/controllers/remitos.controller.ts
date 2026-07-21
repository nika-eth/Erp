import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { anularRemito, generarRemito, listarRemitosPorDocumento } from '../services/remitos.service';
import type { AnularRemitoInput, GenerarRemitoInput } from '../types/domain';

/**
 * POST /api/remitos/generar
 *
 * Despacho físico de mercadería (total o parcial) contra un documento ya
 * facturado. Descuenta stock y suma `cantidad_despachada_total` por ítem
 * dentro de una única transacción.
 */
export async function postGenerarRemito(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const input = req.body as GenerarRemitoInput;
  const remito = await generarRemito(input);

  res.status(201).json({ remito });
}

/**
 * POST /api/remitos/:id/anular
 *
 * Anula un remito emitido no entregado: devuelve stock (salvo regularización)
 * y libera el saldo pendiente de despacho del documento origen.
 */
export async function postAnularRemito(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const input = req.body as AnularRemitoInput;
  const remito = await anularRemito(
    Number(req.params.id),
    { id_sucursal: req.user.id_sucursal, id_usuario: req.user.id_usuario },
    input,
  );

  res.json({ remito });
}

/** GET /api/remitos/documento/:id_documento */
export async function getRemitosPorDocumento(req: Request, res: Response): Promise<void> {
  const remitos = await listarRemitosPorDocumento(Number(req.params.id_documento));
  res.json({ remitos });
}
