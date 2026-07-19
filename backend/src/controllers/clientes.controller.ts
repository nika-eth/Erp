import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { buscarClientePorCuitDni, buscarClientes } from '../services/clientes.service';
import { tipoDocumentoPorIdentificacion } from '../utils/documento.utils';

/**
 * GET /api/clientes/identificacion/:cuitDni
 *
 * Usado por el Módulo de Carga Unificada (F5): al confirmar el CUIT/DNI
 * ingresado, resuelve el cliente y el tipo de comprobante que corresponde
 * preparar (Factura A para CUIT, Factura B para DNI).
 */
export async function getClientePorIdentificacion(req: Request, res: Response): Promise<void> {
  const { cuitDni } = req.params;
  const cliente = await buscarClientePorCuitDni(cuitDni);
  if (!cliente) {
    throw AppError.notFound('CLIENTE_NO_ENCONTRADO', `No existe un cliente con CUIT/DNI ${cuitDni}`);
  }
  res.json({ cliente, tipo_documento_sugerido: tipoDocumentoPorIdentificacion(cliente.cuit_dni) });
}

/** GET /api/clientes?buscar=texto */
export async function getClientes(req: Request, res: Response): Promise<void> {
  const termino = String(req.query.buscar ?? '').trim();
  if (termino.length < 2) {
    res.json({ clientes: [] });
    return;
  }
  const clientes = await buscarClientes(termino);
  res.json({ clientes });
}
