import { Router } from 'express';
import {
  getNotaCreditoProveedorPorId,
  getNotasCreditoProveedor,
  postCrearNotaCreditoProveedor,
} from '../controllers/notasCreditoProveedor.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT, requireRole } from '../middleware/auth';

export const notasCreditoProveedorRouter = Router();

notasCreditoProveedorRouter.use(authenticateJWT);
notasCreditoProveedorRouter.use(requireRole('ADMIN', 'SUPERVISOR'));

notasCreditoProveedorRouter.get('/', asyncHandler(getNotasCreditoProveedor));
notasCreditoProveedorRouter.get('/:id', asyncHandler(getNotaCreditoProveedorPorId));
notasCreditoProveedorRouter.post('/', asyncHandler(postCrearNotaCreditoProveedor));
