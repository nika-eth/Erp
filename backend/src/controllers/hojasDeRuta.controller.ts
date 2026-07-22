import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import {
  agregarOrdenAHoja,
  anularHojaDeRuta,
  confirmarSalidaHojaDeRuta,
  crearHojaDeRuta,
  listarBacklogOrdenesPendientes,
  obtenerHojaDeRuta,
  quitarOrdenDeHoja,
} from '../services/hojasDeRuta.service';
import type { AgregarOrdenAHojaInput, AnularHojaDeRutaInput, CrearHojaDeRutaInput } from '../types/domain';

export async function postCrearHojaDeRuta(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const input = req.body as CrearHojaDeRutaInput;
  const hoja = await crearHojaDeRuta(input, { id_usuario: req.user.id_usuario });

  res.status(201).json({ hoja_de_ruta: hoja });
}

/** GET /api/hojas-de-ruta/backlog — Órdenes de Entrega Pendientes sin viaje asignado. */
export async function getBacklogOrdenesPendientes(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const ordenes = await listarBacklogOrdenesPendientes({ rol: req.user.rol, id_sucursal: req.user.id_sucursal });
  res.json({ ordenes });
}

export async function getHojaDeRuta(req: Request, res: Response): Promise<void> {
  const hoja = await obtenerHojaDeRuta(Number(req.params.id));
  res.json({ hoja_de_ruta: hoja });
}

export async function postAgregarOrdenAHoja(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const input = req.body as AgregarOrdenAHojaInput;
  const hoja = await agregarOrdenAHoja(Number(req.params.id), input, { rol: req.user.rol, id_sucursal: req.user.id_sucursal });

  res.status(201).json({ hoja_de_ruta: hoja });
}

export async function deleteQuitarOrdenDeHoja(req: Request, res: Response): Promise<void> {
  const hoja = await quitarOrdenDeHoja(Number(req.params.id), Number(req.params.id_orden_entrega));
  res.json({ hoja_de_ruta: hoja });
}

export async function postConfirmarSalida(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const hoja = await confirmarSalidaHojaDeRuta(Number(req.params.id), { id_usuario: req.user.id_usuario });
  res.json({ hoja_de_ruta: hoja });
}

export async function postAnularHojaDeRuta(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const input = req.body as AnularHojaDeRutaInput;
  const hoja = await anularHojaDeRuta(Number(req.params.id), { id_usuario: req.user.id_usuario }, input);

  res.json({ hoja_de_ruta: hoja });
}
