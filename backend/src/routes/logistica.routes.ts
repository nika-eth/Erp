import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT } from '../middleware/auth';
import { getCamiones, getZonas } from '../controllers/logistica.controller';

export const logisticaRouter = Router();

logisticaRouter.use(authenticateJWT);

logisticaRouter.get('/zonas', asyncHandler(getZonas));
logisticaRouter.get('/camiones', asyncHandler(getCamiones));
