import { Router } from 'express';
import {
  deleteQuitarOrdenDeHoja,
  getBacklogOrdenesPendientes,
  getHojaDeRuta,
  getListarHojasDeRuta,
  postAgregarOrdenAHoja,
  postAnularHojaDeRuta,
  postConfirmarSalida,
  postCrearHojaDeRuta,
  putActualizarCotHojaDeRuta,
} from '../controllers/hojasDeRuta.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT } from '../middleware/auth';

export const hojasDeRutaRouter = Router();

hojasDeRutaRouter.use(authenticateJWT);

hojasDeRutaRouter.get('/backlog', asyncHandler(getBacklogOrdenesPendientes));
hojasDeRutaRouter.get('/', asyncHandler(getListarHojasDeRuta));
hojasDeRutaRouter.post('/', asyncHandler(postCrearHojaDeRuta));
hojasDeRutaRouter.get('/:id', asyncHandler(getHojaDeRuta));
hojasDeRutaRouter.post('/:id/ordenes', asyncHandler(postAgregarOrdenAHoja));
hojasDeRutaRouter.delete('/:id/ordenes/:id_orden_entrega', asyncHandler(deleteQuitarOrdenDeHoja));
hojasDeRutaRouter.put('/:id/cot', asyncHandler(putActualizarCotHojaDeRuta));
hojasDeRutaRouter.post('/:id/confirmar-salida', asyncHandler(postConfirmarSalida));
hojasDeRutaRouter.post('/:id/anular', asyncHandler(postAnularHojaDeRuta));
