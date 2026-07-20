import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT } from '../middleware/auth';
import { getClientePorIdentificacion, getClientes, postCrearCliente } from '../controllers/clientes.controller';

export const clientesRouter = Router();

clientesRouter.use(authenticateJWT);

clientesRouter.get('/', asyncHandler(getClientes));
clientesRouter.get('/identificacion/:numeroDocumento', asyncHandler(getClientePorIdentificacion));
clientesRouter.post('/', asyncHandler(postCrearCliente));
