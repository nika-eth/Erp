import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { getCuentasEmpresa, getMateriales, getSucursales } from '../controllers/catalogos.controller';

// Sin `requireSession`: son datos de referencia no sensibles y la pantalla
// de login los necesita para poblar el selector de sucursal antes de
// autenticar.
export const catalogosRouter = Router();

catalogosRouter.get('/sucursales', asyncHandler(getSucursales));
catalogosRouter.get('/cuentas-empresa', asyncHandler(getCuentasEmpresa));
catalogosRouter.get('/materiales', asyncHandler(getMateriales));
