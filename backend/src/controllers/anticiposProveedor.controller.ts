import type { Request, Response } from 'express';
import { buscarAnticipoProveedorPorId, buscarAnticiposProveedor } from '../services/anticiposProveedor.service';
import type { EstadoAnticipoProveedor } from '../types/domain';

/** GET /api/anticipos-proveedor?id_proveedor=1&estado=DISPONIBLE */
export async function getAnticiposProveedor(req: Request, res: Response): Promise<void> {
  const idProveedor = req.query.id_proveedor !== undefined ? Number(req.query.id_proveedor) : undefined;
  const estado = req.query.estado as EstadoAnticipoProveedor | undefined;
  const anticipos = await buscarAnticiposProveedor(idProveedor, estado);
  res.json({ anticipos });
}

/** GET /api/anticipos-proveedor/:id */
export async function getAnticipoProveedorPorId(req: Request, res: Response): Promise<void> {
  const anticipo = await buscarAnticipoProveedorPorId(Number(req.params.id));
  res.json({ anticipo });
}
