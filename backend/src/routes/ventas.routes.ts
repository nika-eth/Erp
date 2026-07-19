import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireSession } from '../middleware/session';
import { postFacturarVenta, postGuardarPresupuesto } from '../controllers/ventas.controller';

export const ventasRouter = Router();

ventasRouter.use(requireSession);

ventasRouter.post('/facturar', asyncHandler(postFacturarVenta));
ventasRouter.post('/presupuesto', asyncHandler(postGuardarPresupuesto));
