import type { PoolClient } from 'pg';
import type { EstadoAfip } from '../../types/domain';

export interface FilaComprobanteAfip {
  id_documento: number;
  tipo_comprobante: number | null;
  punto_venta: number | null;
  nro_comprobante_afip: number | null;
  cae: string | null;
  cae_vencimiento: string | null;
  estado_afip: EstadoAfip;
  error_afip_mensaje: string | null;
}

/**
 * Acceso a `comprobantes_afip`. La usan tanto `emisorFiscalAfip.ts` (alta +
 * resultado del CAE en el momento de facturar) como `afip/cola.repository.ts`
 * (reintentos de contingencia) — vive fuera de `src/afip/` porque no es
 * integración con el Web Service en sí, es sólo la tabla satélite.
 */
export async function crearComprobanteAfip(
  client: PoolClient,
  params: { id_documento: number; tipo_comprobante: number | null; punto_venta: number | null; estado_afip: EstadoAfip },
): Promise<FilaComprobanteAfip> {
  const { rows } = await client.query<FilaComprobanteAfip>(
    `INSERT INTO comprobantes_afip (id_documento, tipo_comprobante, punto_venta, estado_afip)
     VALUES ($1, $2, $3, $4)
     RETURNING id_documento, tipo_comprobante, punto_venta, nro_comprobante_afip, cae, cae_vencimiento, estado_afip, error_afip_mensaje`,
    [params.id_documento, params.tipo_comprobante, params.punto_venta, params.estado_afip],
  );
  return rows[0];
}

export async function actualizarResultadoCae(
  client: PoolClient,
  id_documento: number,
  resultado: { cae: string; cae_vencimiento: string; estado_afip: EstadoAfip },
): Promise<FilaComprobanteAfip> {
  const { rows } = await client.query<FilaComprobanteAfip>(
    `UPDATE comprobantes_afip SET cae = $1, cae_vencimiento = $2, estado_afip = $3, error_afip_mensaje = NULL
     WHERE id_documento = $4
     RETURNING id_documento, tipo_comprobante, punto_venta, nro_comprobante_afip, cae, cae_vencimiento, estado_afip, error_afip_mensaje`,
    [resultado.cae, resultado.cae_vencimiento, resultado.estado_afip, id_documento],
  );
  return rows[0];
}

export async function actualizarErrorAfip(
  client: PoolClient,
  id_documento: number,
  params: { estado_afip: EstadoAfip; error_afip_mensaje: string },
): Promise<FilaComprobanteAfip> {
  const { rows } = await client.query<FilaComprobanteAfip>(
    `UPDATE comprobantes_afip SET estado_afip = $1, error_afip_mensaje = $2
     WHERE id_documento = $3
     RETURNING id_documento, tipo_comprobante, punto_venta, nro_comprobante_afip, cae, cae_vencimiento, estado_afip, error_afip_mensaje`,
    [params.estado_afip, params.error_afip_mensaje, id_documento],
  );
  return rows[0];
}
