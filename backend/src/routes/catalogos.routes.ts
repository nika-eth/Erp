import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { getCuentasEmpresa, getSucursales } from '../controllers/catalogos.controller';

// Sin `authenticateJWT`: son datos de referencia no sensibles.
export const catalogosRouter = Router();

catalogosRouter.get('/sucursales', asyncHandler(getSucursales));
catalogosRouter.get('/cuentas-empresa', asyncHandler(getCuentasEmpresa));
