import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { procesarVentaMixta } from '../services/ordenesEntrega.service';
import { emitirVentaInterna, facturarComprobanteInterno, facturarVentaFiscal, guardarPresupuesto } from '../services/ventas.service';
import type { FacturarVentaInput, ProcesarVentaMixtaInput } from '../types/domain';

/**
 * POST /api/ventas/facturar-fiscal
 *
 * Operación FISCAL del mostrador (atajo F12 con el ModoOperacion en
 * FISCAL, ver `RendicionPago.tsx`). Recibe el payload cargado en el Módulo
 * de Carga Unificada y ejecuta, en una única transacción, el alta del
 * documento + cuenta_corriente + la solicitud de CAE a AFIP
 * (`emisorFiscalAfip`).
 *
 * `id_sucursal` e `id_usuario` salen de `req.user` (firmado en el JWT), no
 * del body, para que no se puedan manipular. Si el trigger de límite de
 * crédito rebota la operación, `errorHandler` la traduce a HTTP 422 con
 * `error: "LIMITE_CREDITO_EXCEDIDO"` — salvo que `req.supervisorAutorizacion`
 * esté presente (ver `verifySupervisorOverride`), en cuyo caso se saltea el
 * límite y se audita quién lo autorizó.
 */
export async function postFacturarVentaFiscal(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const input = req.body as FacturarVentaInput;
  const resultado = await facturarVentaFiscal(
    { id_sucursal: req.user.id_sucursal, id_usuario: req.user.id_usuario },
    input,
    req.supervisorAutorizacion ?? null,
  );

  res.status(201).json(resultado);
}

/**
 * POST /api/ventas/emitir-interno
 *
 * Operación INTERNA del mostrador (ModoOperacion en INTERNA): mismo alta de
 * documento + cuenta_corriente que la fiscal, pero nunca llama a
 * `emisorFiscalAfip` — usa `emisorInterno`, que no tiene ninguna dependencia
 * de `src/afip/**` (firewall verificado en CI por `dependency-cruiser`).
 */
export async function postEmitirVentaInterna(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const input = req.body as FacturarVentaInput;
  const resultado = await emitirVentaInterna(
    { id_sucursal: req.user.id_sucursal, id_usuario: req.user.id_usuario },
    input,
    req.supervisorAutorizacion ?? null,
  );

  res.status(201).json(resultado);
}

/**
 * POST /api/ventas/presupuesto
 *
 * Cierre de salida 1 (F2): guarda la cabecera como Presupuesto. No genera
 * movimientos de cuenta corriente ni afecta el crédito del cliente.
 */
export async function postGuardarPresupuesto(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const { cliente_id, items } = req.body as Pick<FacturarVentaInput, 'cliente_id' | 'items'>;
  const documento = await guardarPresupuesto(req.user.id_sucursal, { cliente_id, items });

  res.status(201).json({ documento });
}

/**
 * POST /api/ventas/:id/facturar-interno
 *
 * Convierte un Comprobante Interno ya despachado (Remito X) en una Factura
 * fiscal A/B, generando su Remito R de regularización sin duplicar el
 * descuento de stock.
 */
export async function postFacturarComprobanteInterno(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const resultado = await facturarComprobanteInterno(Number(req.params.id), {
    rol: req.user.rol,
    id_sucursal: req.user.id_sucursal,
  });

  res.status(201).json(resultado);
}

/**
 * POST /api/ventas/facturar-mixta
 *
 * Venta con renglones divididos entre retiro inmediato (despacha ya mismo)
 * y cantidad pendiente (reserva stock y genera una Orden de Entrega,
 * retirable después desde cualquier sucursal — ver `ordenesEntrega.routes.ts`).
 */
export async function postFacturarVentaMixta(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const input = req.body as ProcesarVentaMixtaInput;
  const resultado = await procesarVentaMixta({ id_sucursal: req.user.id_sucursal, id_usuario: req.user.id_usuario }, input);

  res.status(201).json(resultado);
}
