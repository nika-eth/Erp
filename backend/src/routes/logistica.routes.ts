import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT } from '../middleware/auth';
import {
  getCamiones,
  getDocumentosPendientes,
  getOcupacionDiaria,
  getZonas,
  postAsignarEnvio,
  putActualizarCot,
} from '../controllers/logistica.controller';

export const logisticaRouter = Router();

logisticaRouter.use(authenticateJWT);

logisticaRouter.get('/zonas', asyncHandler(getZonas));
logisticaRouter.get('/camiones', asyncHandler(getCamiones));
logisticaRouter.get('/documentos-pendientes', asyncHandler(getDocumentosPendientes));
logisticaRouter.get('/ocupacion', asyncHandler(getOcupacionDiaria));
logisticaRouter.post('/asignar-envio', asyncHandler(postAsignarEnvio));
logisticaRouter.put('/envios/:id/cot', asyncHandler(putActualizarCot));
