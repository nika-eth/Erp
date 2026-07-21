import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT, requireRole } from '../middleware/auth';
import { getProductos, getProductosParaGestion, patchActualizarProducto } from '../controllers/productos.controller';

export const productosRouter = Router();

productosRouter.use(authenticateJWT);

productosRouter.get('/', asyncHandler(getProductos));
productosRouter.get('/gestion', requireRole('ADMIN'), asyncHandler(getProductosParaGestion));
productosRouter.patch('/:id', requireRole('ADMIN'), asyncHandler(patchActualizarProducto));
