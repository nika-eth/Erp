import { Router } from 'express';
import {
  getProveedorPorId,
  getProveedores,
  getProveedoresParaGestion,
  patchActualizarProveedor,
  postCrearProveedor,
} from '../controllers/proveedores.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT, requireRole } from '../middleware/auth';

export const proveedoresRouter = Router();

proveedoresRouter.use(authenticateJWT);
proveedoresRouter.use(requireRole('ADMIN', 'SUPERVISOR'));

proveedoresRouter.get('/', asyncHandler(getProveedores));
proveedoresRouter.get('/gestion', asyncHandler(getProveedoresParaGestion));
proveedoresRouter.get('/:id', asyncHandler(getProveedorPorId));
proveedoresRouter.post('/', asyncHandler(postCrearProveedor));
proveedoresRouter.patch('/:id', asyncHandler(patchActualizarProveedor));
