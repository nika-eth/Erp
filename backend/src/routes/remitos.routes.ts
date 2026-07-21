import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT } from '../middleware/auth';
import { getRemitosPorDocumento, postAnularRemito, postGenerarRemito } from '../controllers/remitos.controller';

export const remitosRouter = Router();

remitosRouter.use(authenticateJWT);

remitosRouter.post('/generar', asyncHandler(postGenerarRemito));
remitosRouter.post('/:id/anular', asyncHandler(postAnularRemito));
remitosRouter.get('/documento/:id_documento', asyncHandler(getRemitosPorDocumento));
