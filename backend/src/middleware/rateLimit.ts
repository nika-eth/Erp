import rateLimit from 'express-rate-limit';
import { AppError } from '../utils/AppError';

const VENTANA_MS = 15 * 60 * 1000;

function excedido(): never {
  throw new AppError(429, 'DEMASIADOS_INTENTOS', 'Demasiados intentos; esperá unos minutos y volvé a intentar.');
}

/** POST /api/auth/login: limita fuerza bruta de usuario/password por IP. */
export const loginRateLimiter = rateLimit({
  windowMs: VENTANA_MS,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: excedido,
});

/**
 * Límite de intentos del PIN de supervisor (4 dígitos, 10.000 combinaciones
 * posibles): sin este límite es trivialmente fuerza-bruteable. Sólo cuenta
 * requests que efectivamente mandan `x-supervisor-pin` — el resto del
 * tráfico normal de `/api/ventas/facturar` no debe verse afectado.
 */
export const supervisorPinRateLimiter = rateLimit({
  windowMs: VENTANA_MS,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.headers['x-supervisor-pin'],
  handler: excedido,
});
