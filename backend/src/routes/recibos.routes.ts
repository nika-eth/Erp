import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT } from '../middleware/auth';
import { postEmitirRecibo } from '../controllers/recibos.controller';

export const recibosRouter = Router();

recibosRouter.use(authenticateJWT);

recibosRouter.post('/emitir', asyncHandler(postEmitirRecibo));
