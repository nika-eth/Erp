import type { Request, Response } from 'express';
import { obtenerFichaCuentaCorriente } from '../services/cuentaCorriente.service';

/** GET /api/cuenta-corriente/:clienteId — Ficha Contable del módulo F9. */
export async function getFichaCuentaCorriente(req: Request, res: Response): Promise<void> {
  const ficha = await obtenerFichaCuentaCorriente(Number(req.params.clienteId));
  res.json(ficha);
}
