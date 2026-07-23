import { Router } from 'express';
import {
  getOrdenEntregaPorNro,
  postAnularOrdenEntrega,
  postRetirarOrdenEntrega,
  putEditarTipoEntregaOrdenEntrega,
} from '../controllers/ordenesEntrega.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT } from '../middleware/auth';

export const ordenesEntregaRouter = Router();

ordenesEntregaRouter.use(authenticateJWT);

ordenesEntregaRouter.get('/:nro_orden', asyncHandler(getOrdenEntregaPorNro));
ordenesEntregaRouter.post('/:nro_orden/retirar', asyncHandler(postRetirarOrdenEntrega));
ordenesEntregaRouter.put('/:nro_orden/tipo-entrega', asyncHandler(putEditarTipoEntregaOrdenEntrega));
ordenesEntregaRouter.post('/:nro_orden/anular', asyncHandler(postAnularOrdenEntrega));
