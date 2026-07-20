import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT } from '../middleware/auth';
import { getFichaCuentaCorriente } from '../controllers/cuentaCorriente.controller';

export const cuentaCorrienteRouter = Router();

cuentaCorrienteRouter.use(authenticateJWT);

cuentaCorrienteRouter.get('/:clienteId', asyncHandler(getFichaCuentaCorriente));
