import { Router } from 'express';
import { getAnticipoProveedorPorId, getAnticiposProveedor } from '../controllers/anticiposProveedor.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT, requireRole } from '../middleware/auth';

export const anticiposProveedorRouter = Router();

anticiposProveedorRouter.use(authenticateJWT);
anticiposProveedorRouter.use(requireRole('ADMIN', 'SUPERVISOR'));

anticiposProveedorRouter.get('/', asyncHandler(getAnticiposProveedor));
anticiposProveedorRouter.get('/:id', asyncHandler(getAnticipoProveedorPorId));
