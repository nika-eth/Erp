import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { facturarVenta, guardarPresupuesto } from '../services/ventas.service';
import type { FacturarVentaInput } from '../types/domain';

/**
 * POST /api/ventas/facturar
 *
 * Endpoint crítico del mostrador (atajo F12). Recibe el payload cargado en
 * el Módulo de Carga Unificada y ejecuta, en una única transacción:
 *   - el alta de la cabecera en `documentos` (dispara la asignación
 *     automática de `nro_remito`),
 *   - el DEBE en `cuenta_corriente` por el total de la venta (dispara la
 *     validación de límite de crédito),
 *   - un HABER en `cuenta_corriente` por cada medio de pago cargado.
 *
 * Si el trigger de límite de crédito rebota la operación, `errorHandler`
 * la traduce a HTTP 422 con `error: "LIMITE_CREDITO_EXCEDIDO"`.
 */
export async function postFacturarVenta(req: Request, res: Response): Promise<void> {
  if (!req.sesion) {
    throw AppError.unauthorized();
  }

  const input = req.body as FacturarVentaInput;
  const resultado = await facturarVenta(req.sesion.id_sucursal, input);

  res.status(201).json(resultado);
}

/**
 * POST /api/ventas/presupuesto
 *
 * Cierre de salida 1 (F2): guarda la cabecera como Presupuesto. No genera
 * movimientos de cuenta corriente ni afecta el crédito del cliente.
 */
export async function postGuardarPresupuesto(req: Request, res: Response): Promise<void> {
  if (!req.sesion) {
    throw AppError.unauthorized();
  }

  const { cliente_id, items } = req.body as Pick<FacturarVentaInput, 'cliente_id' | 'items'>;
  const documento = await guardarPresupuesto(req.sesion.id_sucursal, { cliente_id, items });

  res.status(201).json({ documento });
}
