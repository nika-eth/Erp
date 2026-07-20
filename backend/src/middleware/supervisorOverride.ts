import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { listarSupervisoresConPin } from '../services/usuarios.service';

const PIN_REGEX = /^\d{4}$/;

/**
 * Lee el header opcional `x-supervisor-pin`. Si no viene, el request sigue
 * el flujo normal (sujeto a los triggers estándar). Si viene, valida que
 * coincida con el PIN hasheado de algún SUPERVISOR/ADMIN activo y, de ser
 * así, deja la autorización en `req.supervisorAutorizacion` para que
 * `ventas.service.ts` sepa que debe saltear el límite de crédito y auditar
 * quién lo autorizó.
 *
 * Usar después de `authenticateJWT`: no valida por sí mismo la sesión del
 * vendedor, sólo el PIN del supervisor que autoriza.
 */
export async function verifySupervisorOverride(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const pin = req.headers['x-supervisor-pin'];

  if (!pin) {
    next();
    return;
  }

  if (typeof pin !== 'string' || !PIN_REGEX.test(pin)) {
    throw AppError.badRequest('PIN_SUPERVISOR_INVALIDO', 'x-supervisor-pin debe ser un PIN numérico de 4 dígitos.');
  }

  const supervisores = await listarSupervisoresConPin();

  for (const supervisor of supervisores) {
    // pin_autorizacion_hash no puede ser null acá: listarSupervisoresConPin ya filtra por IS NOT NULL.
    const coincide = await bcrypt.compare(pin, supervisor.pin_autorizacion_hash!);
    if (coincide) {
      req.supervisorAutorizacion = { id_supervisor: supervisor.id_usuario, nombreSupervisor: supervisor.nombre };
      next();
      return;
    }
  }

  throw new AppError(401, 'PIN_SUPERVISOR_INVALIDO', 'PIN de autorización de supervisor incorrecto.');
}
