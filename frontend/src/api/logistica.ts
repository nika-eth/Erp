import { apiFetch } from './client';
import type {
  ActualizarCotInput,
  AsignarEnvioInput,
  Camion,
  CamionJornada,
  DocumentoPendiente,
  EnvioAsignado,
  Zona,
} from '../types/domain';

export function listarZonas(): Promise<{ zonas: Zona[] }> {
  return apiFetch('/logistica/zonas');
}

export function listarCamiones(): Promise<{ camiones: Camion[] }> {
  return apiFetch('/logistica/camiones');
}

export function listarDocumentosPendientes(): Promise<{ documentos: DocumentoPendiente[] }> {
  return apiFetch('/logistica/documentos-pendientes');
}

export function obtenerOcupacionDiaria(fecha: string): Promise<{ fecha: string; camiones: CamionJornada[] }> {
  return apiFetch(`/logistica/ocupacion?fecha=${encodeURIComponent(fecha)}`);
}

export function asignarEnvio(input: AsignarEnvioInput): Promise<{ envio: EnvioAsignado }> {
  return apiFetch('/logistica/asignar-envio', { method: 'POST', body: input });
}

export function actualizarCotEnvio(id_envio: number, input: ActualizarCotInput): Promise<{ envio: EnvioAsignado }> {
  return apiFetch(`/logistica/envios/${id_envio}/cot`, { method: 'PUT', body: input });
}
