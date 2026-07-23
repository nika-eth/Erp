import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticateJWT } from '../middleware/auth';
import { supervisorPinRateLimiter } from '../middleware/rateLimit';
import { verifySupervisorOverride } from '../middleware/supervisorOverride';
import {
  postEmitirVentaInterna,
  postFacturarComprobanteInterno,
  postFacturarVentaFiscal,
  postFacturarVentaMixta,
  postGuardarPresupuesto,
} from '../controllers/ventas.controller';

export const ventasRouter = Router();

ventasRouter.use(authenticateJWT);

// Dos endpoints separados (no uno con `es_fiscal` en el body): el firewall
// entre Operación FISCAL e INTERNA empieza en el routing, no sólo en el
// service — ver `services/emision/`.
ventasRouter.post(
  '/facturar-fiscal',
  supervisorPinRateLimiter,
  asyncHandler(verifySupervisorOverride),
  asyncHandler(postFacturarVentaFiscal),
);
ventasRouter.post(
  '/emitir-interno',
  supervisorPinRateLimiter,
  asyncHandler(verifySupervisorOverride),
  asyncHandler(postEmitirVentaInterna),
);
ventasRouter.post('/presupuesto', asyncHandler(postGuardarPresupuesto));
ventasRouter.post('/facturar-mixta', asyncHandler(postFacturarVentaMixta));
ventasRouter.post('/:id/facturar-interno', asyncHandler(postFacturarComprobanteInterno));
