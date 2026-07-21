import { Router } from 'express';
import {
  getFacturaProveedorPorId,
  getFacturasProveedor,
  postCrearFacturaProveedor,
} from '../controllers/facturasProveedor.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT, requireRole } from '../middleware/auth';

export const facturasProveedorRouter = Router();

facturasProveedorRouter.use(authenticateJWT);
facturasProveedorRouter.use(requireRole('ADMIN', 'SUPERVISOR'));

facturasProveedorRouter.get('/', asyncHandler(getFacturasProveedor));
facturasProveedorRouter.get('/:id', asyncHandler(getFacturaProveedorPorId));
facturasProveedorRouter.post('/', asyncHandler(postCrearFacturaProveedor));
