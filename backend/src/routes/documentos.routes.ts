import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireSession } from '../middleware/session';
import { getDocumentoPorId, getDocumentos } from '../controllers/documentos.controller';

export const documentosRouter = Router();

documentosRouter.use(requireSession);

documentosRouter.get('/', asyncHandler(getDocumentos));
documentosRouter.get('/:id', asyncHandler(getDocumentoPorId));
