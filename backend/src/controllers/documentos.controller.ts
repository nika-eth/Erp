import type { Request, Response } from 'express';
import { buscarDocumentos, obtenerDocumentoPorId } from '../services/documentos.service';
import type { TipoDocumento } from '../types/domain';

const TIPOS_VALIDOS: TipoDocumento[] = ['PRESUPUESTO', 'FACTURA_A', 'FACTURA_B'];

/** GET /api/documentos — Buscador indexado del módulo F3 (Historial). */
export async function getDocumentos(req: Request, res: Response): Promise<void> {
  const { cliente, nro_remito, tipo_documento, id_sucursal, desde, hasta } = req.query;

  const documentos = await buscarDocumentos({
    cliente: cliente ? String(cliente) : undefined,
    nro_remito: nro_remito ? Number(nro_remito) : undefined,
    tipo_documento:
      tipo_documento && TIPOS_VALIDOS.includes(tipo_documento as TipoDocumento)
        ? (tipo_documento as TipoDocumento)
        : undefined,
    id_sucursal: id_sucursal ? Number(id_sucursal) : undefined,
    desde: desde ? String(desde) : undefined,
    hasta: hasta ? String(hasta) : undefined,
  });

  res.json({ documentos });
}

export async function getDocumentoPorId(req: Request, res: Response): Promise<void> {
  const documento = await obtenerDocumentoPorId(Number(req.params.id));
  res.json({ documento });
}
