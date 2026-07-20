import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireSession } from '../middleware/session';
import {
  getCamiones,
  getDocumentosPendientes,
  getOcupacionDiaria,
  getZonas,
  postAsignarEnvio,
} from '../controllers/logistica.controller';

export const logisticaRouter = Router();

logisticaRouter.use(requireSession);

logisticaRouter.get('/zonas', asyncHandler(getZonas));
logisticaRouter.get('/camiones', asyncHandler(getCamiones));
logisticaRouter.get('/documentos-pendientes', asyncHandler(getDocumentosPendientes));
logisticaRouter.get('/ocupacion', asyncHandler(getOcupacionDiaria));
logisticaRouter.post('/asignar-envio', asyncHandler(postAsignarEnvio));
