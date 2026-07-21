import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT } from '../middleware/auth';
import { getProductos } from '../controllers/productos.controller';

export const productosRouter = Router();

productosRouter.use(authenticateJWT);

productosRouter.get('/', asyncHandler(getProductos));
