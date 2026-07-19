/**
 * Error de aplicación con código HTTP y código de negocio asociados.
 * `errorHandler` lo serializa directamente; cualquier otro error se
 * trata como 500 y no expone detalles internos al cliente.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(code: string, message: string, details?: unknown): AppError {
    return new AppError(400, code, message, details);
  }

  static notFound(code: string, message: string): AppError {
    return new AppError(404, code, message);
  }

  static unprocessable(code: string, message: string, details?: unknown): AppError {
    return new AppError(422, code, message, details);
  }

  static unauthorized(message = 'No autorizado'): AppError {
    return new AppError(401, 'NO_AUTORIZADO', message);
  }

  static forbidden(message = 'Acceso denegado'): AppError {
    return new AppError(403, 'ACCESO_DENEGADO', message);
  }
}
