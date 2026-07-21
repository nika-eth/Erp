import { Router } from 'express';
import {
  getOrdenesPago,
  getOrdenPagoPorId,
  postAnularOrdenPago,
  postEmitirOrdenPago,
} from '../controllers/ordenesPago.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT, requireRole } from '../middleware/auth';

export const ordenesPagoRouter = Router();

ordenesPagoRouter.use(authenticateJWT);
ordenesPagoRouter.use(requireRole('ADMIN', 'SUPERVISOR'));

ordenesPagoRouter.get('/', asyncHandler(getOrdenesPago));
ordenesPagoRouter.get('/:id', asyncHandler(getOrdenPagoPorId));
ordenesPagoRouter.post('/', asyncHandler(postEmitirOrdenPago));
ordenesPagoRouter.post('/:id/anular', asyncHandler(postAnularOrdenPago));
