import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { buscarClientePorNumeroDocumento, buscarClientes, crearCliente } from '../services/clientes.service';
import { tipoDocumentoVentaPorCliente } from '../utils/identificacion.utils';
import type { CrearClienteInput } from '../types/domain';

/**
 * GET /api/clientes/identificacion/:numeroDocumento
 *
 * Usado por el Módulo de Carga Unificada (F5): al confirmar el CUIT/DNI
 * ingresado, resuelve el cliente y el tipo de comprobante que corresponde
 * preparar (Factura A para CUIT, Factura B para DNI).
 */
export async function getClientePorIdentificacion(req: Request, res: Response): Promise<void> {
  const { numeroDocumento } = req.params;
  const cliente = await buscarClientePorNumeroDocumento(numeroDocumento);
  if (!cliente) {
    throw AppError.notFound('CLIENTE_NO_ENCONTRADO', `No existe un cliente con documento ${numeroDocumento}`);
  }
  res.json({ cliente, tipo_documento_sugerido: tipoDocumentoVentaPorCliente(cliente.tipo_documento) });
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

/**
 * POST /api/clientes
 *
 * Alta de cliente en mostrador. Disparado desde Carga Unificada (F5) cuando
 * la búsqueda por CUIT/DNI no encuentra a nadie, para no tener que salir de
 * la venta en curso a cargarlo por otro lado.
 */
export async function postCrearCliente(req: Request, res: Response): Promise<void> {
  const input = req.body as CrearClienteInput;
  const cliente = await crearCliente(input);
  res.status(201).json({ cliente });
}
