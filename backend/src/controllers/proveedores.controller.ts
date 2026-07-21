import type { Request, Response } from 'express';
import {
  actualizarProveedor,
  buscarProveedorPorId,
  buscarProveedores,
  buscarProveedoresParaGestion,
  crearProveedor,
} from '../services/proveedores.service';
import type { ActualizarProveedorInput, CrearProveedorInput } from '../types/domain';

/** GET /api/proveedores?buscar=texto — sólo activos. */
export async function getProveedores(req: Request, res: Response): Promise<void> {
  const termino = String(req.query.buscar ?? '').trim();
  if (termino.length < 2) {
    res.json({ proveedores: [] });
    return;
  }
  const proveedores = await buscarProveedores(termino);
  res.json({ proveedores });
}

/** GET /api/proveedores/gestion?buscar=texto — incluye inactivos. */
export async function getProveedoresParaGestion(req: Request, res: Response): Promise<void> {
  const termino = String(req.query.buscar ?? '').trim();
  if (termino.length < 2) {
    res.json({ proveedores: [] });
    return;
  }
  const proveedores = await buscarProveedoresParaGestion(termino);
  res.json({ proveedores });
}

/** GET /api/proveedores/:id */
export async function getProveedorPorId(req: Request, res: Response): Promise<void> {
  const proveedor = await buscarProveedorPorId(Number(req.params.id));
  res.json({ proveedor });
}

/** POST /api/proveedores */
export async function postCrearProveedor(req: Request, res: Response): Promise<void> {
  const input = req.body as CrearProveedorInput;
  const proveedor = await crearProveedor(input);
  res.status(201).json({ proveedor });
}

/** PATCH /api/proveedores/:id */
export async function patchActualizarProveedor(req: Request, res: Response): Promise<void> {
  const input = req.body as ActualizarProveedorInput;
  const proveedor = await actualizarProveedor(Number(req.params.id), input);
  res.json({ proveedor });
}
