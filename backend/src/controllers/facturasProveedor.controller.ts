import type { Request, Response } from 'express';
import { buscarFacturaProveedorPorId, buscarFacturasProveedor, crearFacturaProveedor } from '../services/facturasProveedor.service';
import { AppError } from '../utils/AppError';
import type { CrearFacturaProveedorInput, EstadoFacturaProveedor } from '../types/domain';

/** GET /api/facturas-proveedor?id_proveedor=1&estado=PENDIENTE */
export async function getFacturasProveedor(req: Request, res: Response): Promise<void> {
  const idProveedor = req.query.id_proveedor !== undefined ? Number(req.query.id_proveedor) : undefined;
  const estado = req.query.estado as EstadoFacturaProveedor | undefined;
  const facturas = await buscarFacturasProveedor(idProveedor, estado);
  res.json({ facturas });
}

/** GET /api/facturas-proveedor/:id */
export async function getFacturaProveedorPorId(req: Request, res: Response): Promise<void> {
  const factura = await buscarFacturaProveedorPorId(Number(req.params.id));
  res.json({ factura });
}

/** POST /api/facturas-proveedor */
export async function postCrearFacturaProveedor(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  const input = req.body as CrearFacturaProveedorInput;
  const factura = await crearFacturaProveedor(input, req.user.id_usuario);
  res.status(201).json({ factura });
}
