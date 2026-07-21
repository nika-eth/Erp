import type { Request, Response } from 'express';
import { listarCuentasEmpresa, listarSucursales } from '../services/catalogos.service';

export async function getSucursales(_req: Request, res: Response): Promise<void> {
  res.json({ sucursales: await listarSucursales() });
}

export async function getCuentasEmpresa(_req: Request, res: Response): Promise<void> {
  res.json({ cuentas: await listarCuentasEmpresa() });
}
