import type { Request, Response } from 'express';
import {
  buscarNotaCreditoProveedorPorId,
  buscarNotasCreditoProveedor,
  crearNotaCreditoProveedor,
} from '../services/notasCreditoProveedor.service';
import { AppError } from '../utils/AppError';
import type { CrearNotaCreditoProveedorInput, EstadoNotaCreditoProveedor } from '../types/domain';

/** GET /api/notas-credito-proveedor?id_proveedor=1&estado=DISPONIBLE */
export async function getNotasCreditoProveedor(req: Request, res: Response): Promise<void> {
  const idProveedor = req.query.id_proveedor !== undefined ? Number(req.query.id_proveedor) : undefined;
  const estado = req.query.estado as EstadoNotaCreditoProveedor | undefined;
  const notasCredito = await buscarNotasCreditoProveedor(idProveedor, estado);
  res.json({ notasCredito });
}

/** GET /api/notas-credito-proveedor/:id */
export async function getNotaCreditoProveedorPorId(req: Request, res: Response): Promise<void> {
  const notaCredito = await buscarNotaCreditoProveedorPorId(Number(req.params.id));
  res.json({ notaCredito });
}

/** POST /api/notas-credito-proveedor */
export async function postCrearNotaCreditoProveedor(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  const input = req.body as CrearNotaCreditoProveedorInput;
  const notaCredito = await crearNotaCreditoProveedor(input, req.user.id_usuario);
  res.status(201).json({ notaCredito });
}
