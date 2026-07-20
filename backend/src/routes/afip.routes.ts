import { Router } from 'express';
import { getEstadoAfip, postReintentarTarea } from '../controllers/afip.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT, requireRole } from '../middleware/auth';

export const afipRouter = Router();

afipRouter.use(authenticateJWT);

afipRouter.get('/estado', asyncHandler(getEstadoAfip));
afipRouter.post('/reintentar/:idTarea', requireRole('ADMIN', 'SUPERVISOR'), asyncHandler(postReintentarTarea));
