import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT } from '../middleware/auth';
import { getDocumentoPorId, getDocumentos } from '../controllers/documentos.controller';

export const documentosRouter = Router();

documentosRouter.use(authenticateJWT);

documentosRouter.get('/', asyncHandler(getDocumentos));
documentosRouter.get('/:id', asyncHandler(getDocumentoPorId));
