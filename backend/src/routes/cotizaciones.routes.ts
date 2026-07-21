import { Router } from 'express';
import { getCotizacionPorFecha, getCotizaciones, postCargarCotizacion } from '../controllers/cotizaciones.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT, requireRole } from '../middleware/auth';

export const cotizacionesRouter = Router();

cotizacionesRouter.use(authenticateJWT);
cotizacionesRouter.use(requireRole('ADMIN', 'SUPERVISOR'));

cotizacionesRouter.get('/', asyncHandler(getCotizaciones));
cotizacionesRouter.get('/:moneda/:fecha', asyncHandler(getCotizacionPorFecha));
cotizacionesRouter.post('/', asyncHandler(postCargarCotizacion));
