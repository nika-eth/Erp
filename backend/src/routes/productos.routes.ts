import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT } from '../middleware/auth';
import { getProductos, getProductosParaGestion, patchActualizarProducto } from '../controllers/productos.controller';

export const productosRouter = Router();

productosRouter.use(authenticateJWT);

productosRouter.get('/', asyncHandler(getProductos));
productosRouter.get('/gestion', asyncHandler(getProductosParaGestion));
productosRouter.patch('/:id', asyncHandler(patchActualizarProducto));
