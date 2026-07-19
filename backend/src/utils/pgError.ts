/**
 * Subconjunto de campos que `pg` adjunta a los errores lanzados por
 * PostgreSQL (ver DatabaseError de node-postgres). Los triggers de la base
 * (asignación de remito, validación de límite de crédito) se manifiestan acá.
 */
export interface PgDatabaseError extends Error {
  code?: string; // SQLSTATE, ej: '23505' unique_violation, 'P0001' raise_exception
  detail?: string;
  constraint?: string;
  table?: string;
}

export function isPgDatabaseError(err: unknown): err is PgDatabaseError {
  return err instanceof Error && typeof (err as PgDatabaseError).code === 'string';
}

/** SQLSTATE que Postgres asigna por defecto a `RAISE EXCEPTION` sin ERRCODE explícito. */
export const SQLSTATE_RAISE_EXCEPTION = 'P0001';
export const SQLSTATE_UNIQUE_VIOLATION = '23505';
export const SQLSTATE_FOREIGN_KEY_VIOLATION = '23503';
export const SQLSTATE_CHECK_VIOLATION = '23514';

/**
 * El trigger de límite de crédito rebota la transacción con RAISE EXCEPTION.
 * Se detecta primero por SQLSTATE ('P0001') y, como respaldo, por el texto
 * del mensaje, ya que distintas versiones del trigger pueden usar un
 * ERRCODE custom.
 */
export function esErrorLimiteCredito(err: PgDatabaseError): boolean {
  if (err.code === SQLSTATE_RAISE_EXCEPTION) return true;
  const mensaje = err.message?.toLowerCase() ?? '';
  return mensaje.includes('límite de crédito') || mensaje.includes('limite de credito') || mensaje.includes('credit');
}
