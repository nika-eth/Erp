import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireSession } from '../middleware/session';
import { getClientePorIdentificacion, getClientes } from '../controllers/clientes.controller';

export const clientesRouter = Router();

clientesRouter.use(requireSession);

clientesRouter.get('/', asyncHandler(getClientes));
clientesRouter.get('/identificacion/:cuitDni', asyncHandler(getClientePorIdentificacion));
