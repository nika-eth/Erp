import type { PoolClient } from 'pg';

export interface FilaComprobanteInterno {
  id_documento: number;
  correlativo_interno: string;
  estado_facturacion_interna: 'PENDIENTE' | 'FACTURADA';
}

/** Acceso a `comprobantes_internos`. Cero relación con AFIP — no importar nada de `src/afip/` acá. */
export async function crearComprobanteInterno(
  client: PoolClient,
  params: { id_documento: number; nro_remito: number | null },
): Promise<FilaComprobanteInterno> {
  const correlativo = `X-${params.nro_remito ?? params.id_documento}`;
  const { rows } = await client.query<FilaComprobanteInterno>(
    `INSERT INTO comprobantes_internos (id_documento, correlativo_interno, estado_facturacion_interna)
     VALUES ($1, $2, 'PENDIENTE')
     RETURNING id_documento, correlativo_interno, estado_facturacion_interna`,
    [params.id_documento, correlativo],
  );
  return rows[0];
}

/** Usado por `facturarComprobanteInterno` al convertir un CI ya despachado en Factura fiscal. */
export async function obtenerComprobanteInterno(client: PoolClient, id_documento: number): Promise<FilaComprobanteInterno | null> {
  const { rows } = await client.query<FilaComprobanteInterno>(
    `SELECT id_documento, correlativo_interno, estado_facturacion_interna FROM comprobantes_internos WHERE id_documento = $1 FOR UPDATE`,
    [id_documento],
  );
  return rows[0] ?? null;
}

export async function marcarComprobanteInternoFacturado(client: PoolClient, id_documento: number): Promise<void> {
  await client.query(`UPDATE comprobantes_internos SET estado_facturacion_interna = 'FACTURADA' WHERE id_documento = $1`, [
    id_documento,
  ]);
}
