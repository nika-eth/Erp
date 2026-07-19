import type { Request, Response } from 'express';
import { listarCuentasEmpresa, listarSucursales } from '../services/catalogos.service';
import { CATALOGO_MATERIALES } from '../data/catalogoMateriales';

export async function getSucursales(_req: Request, res: Response): Promise<void> {
  res.json({ sucursales: await listarSucursales() });
}

export async function getCuentasEmpresa(_req: Request, res: Response): Promise<void> {
  res.json({ cuentas: await listarCuentasEmpresa() });
}

/** Catálogo flotante de hierros para el módulo F1. */
export async function getMateriales(_req: Request, res: Response): Promise<void> {
  res.json({ materiales: CATALOGO_MATERIALES });
}
