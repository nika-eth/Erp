import { pool } from '../config/db';
import { AppError } from '../utils/AppError';
import type { Documento, TipoDocumento } from '../types/domain';

export interface FiltroHistorial {
  cliente?: string;
  nro_remito?: number;
  tipo_documento?: TipoDocumento;
  id_sucursal?: number;
  desde?: string;
  hasta?: string;
  limit?: number;
}

/** Buscador indexado de Facturas y Presupuestos para el módulo F3. */
export async function buscarDocumentos(filtro: FiltroHistorial): Promise<Documento[]> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  if (filtro.cliente) {
    valores.push(`%${filtro.cliente}%`);
    condiciones.push(`(c.nombre ILIKE $${valores.length} OR c.cuit_dni ILIKE $${valores.length})`);
  }
  if (filtro.nro_remito) {
    valores.push(filtro.nro_remito);
    condiciones.push(`d.nro_remito = $${valores.length}`);
  }
  if (filtro.tipo_documento) {
    valores.push(filtro.tipo_documento);
    condiciones.push(`d.tipo_documento = $${valores.length}`);
  }
  if (filtro.id_sucursal) {
    valores.push(filtro.id_sucursal);
    condiciones.push(`d.id_sucursal_origen = $${valores.length}`);
  }
  if (filtro.desde) {
    valores.push(filtro.desde);
    condiciones.push(`d.fecha >= $${valores.length}`);
  }
  if (filtro.hasta) {
    valores.push(filtro.hasta);
    condiciones.push(`d.fecha <= $${valores.length}`);
  }

  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
  valores.push(Math.min(filtro.limit ?? 50, 200));

  const { rows } = await pool.query<Documento & { cliente_nombre: string; sucursal_nombre: string }>(
    `SELECT
       d.id_documento, d.id_sucursal_origen, d.nro_remito, d.fecha, d.cliente_id,
       d.total_neto, d.tipo_documento, d.items,
       c.nombre AS cliente_nombre,
       s.nombre AS sucursal_nombre
     FROM documentos d
     JOIN clientes c ON c.id_cliente = d.cliente_id
     JOIN sucursales s ON s.id_sucursal = d.id_sucursal_origen
     ${where}
     ORDER BY d.fecha DESC
     LIMIT $${valores.length}`,
    valores,
  );
  return rows;
}

export async function obtenerDocumentoPorId(id_documento: number): Promise<Documento> {
  const { rows } = await pool.query<Documento>(
    `SELECT id_documento, id_sucursal_origen, nro_remito, fecha, cliente_id, total_neto, tipo_documento, items
     FROM documentos WHERE id_documento = $1`,
    [id_documento],
  );
  const documento = rows[0];
  if (!documento) {
    throw AppError.notFound('DOCUMENTO_NO_ENCONTRADO', `No existe el documento id_documento=${id_documento}`);
  }
  return documento;
}
