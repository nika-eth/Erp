import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import {
  esErrorLimiteCredito,
  isPgDatabaseError,
  SQLSTATE_FOREIGN_KEY_VIOLATION,
  SQLSTATE_UNIQUE_VIOLATION,
} from '../utils/pgError';

/**
 * Middleware de error centralizado. Debe registrarse último, después de
 * todas las rutas. Traduce errores de dominio (`AppError`) y errores crudos
 * de PostgreSQL (incluyendo los que lanzan los triggers) a respuestas HTTP
 * consistentes, sin filtrar detalles internos en errores no controlados.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      details: err.details,
    });
    return;
  }

  if (isPgDatabaseError(err)) {
    if (esErrorLimiteCredito(err)) {
      res.status(422).json({
        error: 'LIMITE_CREDITO_EXCEDIDO',
        message: 'La operación fue rechazada: el cliente supera su límite de crédito habilitado.',
        details: err.detail ?? err.message,
      });
      return;
    }

    if (err.code === SQLSTATE_UNIQUE_VIOLATION) {
      res.status(409).json({
        error: 'REGISTRO_DUPLICADO',
        message: 'Ya existe un registro con esos datos.',
        details: err.detail,
      });
      return;
    }

    if (err.code === SQLSTATE_FOREIGN_KEY_VIOLATION) {
      res.status(400).json({
        error: 'REFERENCIA_INVALIDA',
        message: 'La operación referencia un registro que no existe (cliente, cuenta o documento inválido).',
        details: err.detail,
      });
      return;
    }
  }

  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({
    error: 'ERROR_INTERNO',
    message: 'Ocurrió un error inesperado en el servidor.',
  });
}
