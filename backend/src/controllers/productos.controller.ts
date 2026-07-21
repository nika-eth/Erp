import type { Request, Response } from 'express';
import { buscarProductos } from '../services/productos.service';

/** GET /api/productos?buscar=texto — catálogo flotante de Carga Unificada (F1). */
export async function getProductos(req: Request, res: Response): Promise<void> {
  const termino = String(req.query.buscar ?? '').trim();
  if (termino.length < 2) {
    res.json({ productos: [] });
    return;
  }
  const productos = await buscarProductos(termino);
  res.json({ productos });
}
