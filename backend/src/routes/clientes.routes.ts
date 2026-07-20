import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT } from '../middleware/auth';
import { getClientePorIdentificacion, getClientes } from '../controllers/clientes.controller';

export const clientesRouter = Router();

clientesRouter.use(authenticateJWT);

clientesRouter.get('/', asyncHandler(getClientes));
clientesRouter.get('/identificacion/:cuitDni', asyncHandler(getClientePorIdentificacion));
