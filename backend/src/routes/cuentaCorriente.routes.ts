import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireSession } from '../middleware/session';
import { getFichaCuentaCorriente } from '../controllers/cuentaCorriente.controller';

export const cuentaCorrienteRouter = Router();

cuentaCorrienteRouter.use(requireSession);

cuentaCorrienteRouter.get('/:clienteId', asyncHandler(getFichaCuentaCorriente));
