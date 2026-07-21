import type { Request, Response } from 'express';
import { actualizarProducto, buscarProductos, buscarProductosParaGestion } from '../services/productos.service';
import type { ActualizarProductoInput } from '../types/domain';

/** GET /api/productos?buscar=texto — catálogo flotante de Carga Unificada (F1). Sólo activos. */
export async function getProductos(req: Request, res: Response): Promise<void> {
  const termino = String(req.query.buscar ?? '').trim();
  if (termino.length < 2) {
    res.json({ productos: [] });
    return;
  }
  const productos = await buscarProductos(termino);
  res.json({ productos });
}

/** GET /api/productos/gestion?buscar=texto — Gestión de Productos (F7). Incluye inactivos. */
export async function getProductosParaGestion(req: Request, res: Response): Promise<void> {
  const termino = String(req.query.buscar ?? '').trim();
  if (termino.length < 2) {
    res.json({ productos: [] });
    return;
  }
  const productos = await buscarProductosParaGestion(termino);
  res.json({ productos });
}

/** PATCH /api/productos/:id — corrige datos de un producto existente (Gestión de Productos). */
export async function patchActualizarProducto(req: Request, res: Response): Promise<void> {
  const input = req.body as ActualizarProductoInput;
  const producto = await actualizarProducto(Number(req.params.id), input);
  res.json({ producto });
}
