import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT } from '../middleware/auth';
import { supervisorPinRateLimiter } from '../middleware/rateLimit';
import { verifySupervisorOverride } from '../middleware/supervisorOverride';
import {
  postFacturarComprobanteInterno,
  postFacturarVenta,
  postGuardarPresupuesto,
} from '../controllers/ventas.controller';

export const ventasRouter = Router();

ventasRouter.use(authenticateJWT);

ventasRouter.post(
  '/facturar',
  supervisorPinRateLimiter,
  asyncHandler(verifySupervisorOverride),
  asyncHandler(postFacturarVenta),
);
ventasRouter.post('/presupuesto', asyncHandler(postGuardarPresupuesto));
ventasRouter.post('/:id/facturar-interno', asyncHandler(postFacturarComprobanteInterno));
