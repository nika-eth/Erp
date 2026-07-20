import { vi } from 'vitest';

/**
 * Mock de `pg` para testear la lógica de negocio y el wiring HTTP sin una
 * base de datos real. Se registra acá (vitest.config.ts -> setupFiles) para
 * que `vi.mock('pg', ...)` quede hoisteado antes de que cualquier módulo de
 * la app importe `pg`.
 *
 * Cada test controla las respuestas con `setQueryHandler`, que recibe el SQL
 * y los parámetros de cada `query()` (tanto del pool como del client de una
 * transacción) y decide qué devolver o qué error lanzar.
 */

export interface MockQueryResult {
  rows: unknown[];
}

export type QueryHandler = (sql: string, params: unknown[]) => MockQueryResult;

export interface LoggedQuery {
  sql: string;
  params: unknown[];
}

export const queryLog: LoggedQuery[] = [];

let handler: QueryHandler = () => ({ rows: [] });

export function setQueryHandler(nuevoHandler: QueryHandler): void {
  handler = nuevoHandler;
}

export function resetQueryLog(): void {
  queryLog.length = 0;
}

function ejecutarQuery(sql: string, params: unknown[] = []): MockQueryResult {
  queryLog.push({ sql, params });
  const normalizado = sql.trim().toUpperCase();
  if (normalizado === 'BEGIN' || normalizado === 'COMMIT' || normalizado === 'ROLLBACK') {
    return { rows: [] };
  }
  return handler(sql, params);
}

class MockPoolClient {
  query = vi.fn(async (sql: string, params: unknown[] = []) => ejecutarQuery(sql, params));
  release = vi.fn();
}

class MockPool {
  query = vi.fn(async (sql: string, params: unknown[] = []) => ejecutarQuery(sql, params));
  connect = vi.fn(async () => new MockPoolClient());
  on = vi.fn();
  end = vi.fn(async () => {});
}

vi.mock('pg', () => ({ Pool: MockPool }));
