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
 * El trigger de límite de crédito (`fn_validar_limite_credito`, ver
 * `003_usuarios_auth.sql`) rebota la transacción con
 * `RAISE EXCEPTION 'Limite de credito excedido para el cliente %'`. Se
 * detecta primero por SQLSTATE ('P0001', el que Postgres asigna a un RAISE
 * sin ERRCODE explícito) y, como respaldo, por la frase exacta del mensaje
 * — nunca por la palabra suelta "credit": eso también matchea, por
 * ejemplo, cualquier error sobre `notas_credito_proveedor` (contiene
 * "credit" dentro de "crédito"), clasificando mal un error no relacionado.
 */
export function esErrorLimiteCredito(err: PgDatabaseError): boolean {
  if (err.code === SQLSTATE_RAISE_EXCEPTION) return true;
  const mensaje = err.message?.toLowerCase() ?? '';
  return mensaje.includes('límite de crédito') || mensaje.includes('limite de credito');
}
