import type { PoolClient } from 'pg';
import { withTransaction } from '../config/db';
import { AppError } from '../utils/AppError';
import { redondearMoneda } from '../utils/documento.utils';
import { buscarClientePorId } from './clientes.service';
import type {
  CuentaEmpresa,
  DetallePagoRecibo,
  EmitirReciboInput,
  EmitirReciboResult,
  MovimientoCuentaCorriente,
  Recibo,
} from '../types/domain';

function validarPayload(input: EmitirReciboInput): void {
  if (!Number.isInteger(input.cliente_id) || input.cliente_id <= 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'cliente_id es requerido y debe ser un entero positivo.');
  }
  if (!Array.isArray(input.pagos) || input.pagos.length === 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'El recibo debe tener al menos un medio de pago cargado.');
  }
  for (const pago of input.pagos) {
    if (!Number.isInteger(pago.id_cuenta) || pago.monto <= 0) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'Cada pago requiere id_cuenta válido y monto positivo.');
    }
  }
}

async function obtenerCuentasEmpresa(ids: number[], client: PoolClient): Promise<Map<number, CuentaEmpresa>> {
  const { rows } = await client.query<CuentaEmpresa>(
    `SELECT id_cuenta, nombre_cuenta FROM cuentas_empresa WHERE id_cuenta = ANY($1::int[])`,
    [ids],
  );
  const mapa = new Map(rows.map((r) => [r.id_cuenta, r]));
  const faltantes = ids.filter((id) => !mapa.has(id));
  if (faltantes.length > 0) {
    throw AppError.badRequest('CUENTA_EMPRESA_INVALIDA', `No existen las cuentas de cobro: ${faltantes.join(', ')}`);
  }
  return mapa;
}

/**
 * Emite un recibo de cobranza: cabecera en `recibos` (con `nro_recibo`
 * correlativo por sucursal, asignado por trigger), desglose en
 * `recibos_detalles_pago`, y un HABER en `cuenta_corriente` por cada medio
 * de pago para bajar la deuda del cliente — todo dentro de una única
 * transacción.
 */
export async function emitirRecibo(
  contexto: { id_sucursal: number; id_usuario: number },
  input: EmitirReciboInput,
): Promise<EmitirReciboResult> {
  validarPayload(input);
  await buscarClientePorId(input.cliente_id);

  const montoTotal = redondearMoneda(input.pagos.reduce((acc, p) => acc + p.monto, 0));

  return withTransaction(async (client) => {
    const cuentasEmpresa = await obtenerCuentasEmpresa(
      input.pagos.map((p) => p.id_cuenta),
      client,
    );

    const { rows: reciboRows } = await client.query<Recibo>(
      `INSERT INTO recibos (cliente_id, id_sucursal, monto_total, id_usuario)
       VALUES ($1, $2, $3, $4)
       RETURNING id_recibo, nro_recibo, cliente_id, id_sucursal, fecha, monto_total, id_usuario`,
      [input.cliente_id, contexto.id_sucursal, montoTotal, contexto.id_usuario],
    );
    const recibo = reciboRows[0];

    const detalles: DetallePagoRecibo[] = [];
    const movimientos: MovimientoCuentaCorriente[] = [];

    for (const pago of input.pagos) {
      const cuenta = cuentasEmpresa.get(pago.id_cuenta)!;
      const nroComprobante = pago.nro_comprobante?.trim() || null;

      const { rows: detalleRows } = await client.query<DetallePagoRecibo>(
        `INSERT INTO recibos_detalles_pago (id_recibo, id_cuenta, monto, nro_comprobante)
         VALUES ($1, $2, $3, $4)
         RETURNING id_detalle, id_recibo, id_cuenta, monto, nro_comprobante`,
        [recibo.id_recibo, pago.id_cuenta, pago.monto, nroComprobante],
      );
      detalles.push(detalleRows[0]);

      const { rows: movimientoRows } = await client.query<MovimientoCuentaCorriente>(
        `INSERT INTO cuenta_corriente (cliente_id, fecha, debe, haber, id_recibo, id_cuenta, concepto)
         VALUES ($1, NOW(), 0, $2, $3, $4, $5)
         RETURNING id_movimiento, cliente_id, fecha, debe, haber, id_documento, id_cuenta, id_recibo, concepto`,
        [
          input.cliente_id,
          pago.monto,
          recibo.id_recibo,
          pago.id_cuenta,
          `Cobranza Recibo ${recibo.nro_recibo} - ${cuenta.nombre_cuenta}`,
        ],
      );
      movimientos.push(movimientoRows[0]);
    }

    const { rows: saldoRows } = await client.query<{ saldo: string }>(
      `SELECT COALESCE(SUM(debe) - SUM(haber), 0) AS saldo FROM cuenta_corriente WHERE cliente_id = $1`,
      [input.cliente_id],
    );

    return { recibo, detalles, movimientos, saldo_actual: Number(saldoRows[0].saldo) };
  });
}
