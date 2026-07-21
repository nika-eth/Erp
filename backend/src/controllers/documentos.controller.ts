import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { buscarDocumentos, obtenerDocumentoPorId } from '../services/documentos.service';
import type { TipoDocumento } from '../types/domain';

const TIPOS_VALIDOS: TipoDocumento[] = ['PRESUPUESTO', 'FACTURA_A', 'FACTURA_B'];

/**
 * GET /api/documentos — Buscador indexado del módulo F3 (Historial). Un
 * VENDEDOR queda forzado a su propia sucursal aunque mande otro `id_sucursal`
 * por query; ADMIN/SUPERVISOR pueden filtrar libremente.
 */
export async function getDocumentos(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const { cliente, nro_remito, tipo_documento, id_sucursal, desde, hasta } = req.query;

  const idSucursalFiltro =
    req.user.rol === 'VENDEDOR' ? req.user.id_sucursal : id_sucursal ? Number(id_sucursal) : undefined;

  const documentos = await buscarDocumentos({
    cliente: cliente ? String(cliente) : undefined,
    nro_remito: nro_remito ? Number(nro_remito) : undefined,
    tipo_documento:
      tipo_documento && TIPOS_VALIDOS.includes(tipo_documento as TipoDocumento)
        ? (tipo_documento as TipoDocumento)
        : undefined,
    id_sucursal: idSucursalFiltro,
    desde: desde ? String(desde) : undefined,
    hasta: hasta ? String(hasta) : undefined,
  });

  res.json({ documentos });
}

export async function getDocumentoPorId(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const documento = await obtenerDocumentoPorId(Number(req.params.id), {
    rol: req.user.rol,
    id_sucursal: req.user.id_sucursal,
  });
  res.json({ documento });
}
