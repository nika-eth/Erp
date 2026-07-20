import { apiFetch } from './client';
import type { EmitirReciboInput, EmitirReciboResult } from '../types/domain';

export function emitirRecibo(input: EmitirReciboInput): Promise<EmitirReciboResult> {
  return apiFetch('/recibos/emitir', { method: 'POST', body: input });
}
