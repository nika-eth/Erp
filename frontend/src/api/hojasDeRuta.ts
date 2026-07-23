import { apiFetch } from './client';
import type {
  ActualizarCotHojaInput,
  AgregarOrdenAHojaInput,
  AnularHojaDeRutaInput,
  CrearHojaDeRutaInput,
  HojaDeRuta,
  OrdenEntregaBacklog,
} from '../types/domain';

/** Backlog de la Pizarra: órdenes de envío a domicilio pendientes, sin viaje asignado. */
export function listarBacklog(): Promise<{ ordenes: OrdenEntregaBacklog[] }> {
  return apiFetch('/hojas-de-ruta/backlog');
}

export function crearHojaDeRuta(input: CrearHojaDeRutaInput): Promise<{ hoja_de_ruta: HojaDeRuta }> {
  return apiFetch('/hojas-de-ruta', { method: 'POST', body: input });
}

export function obtenerHojaDeRuta(id: number): Promise<{ hoja_de_ruta: HojaDeRuta }> {
  return apiFetch(`/hojas-de-ruta/${id}`);
}

/** Agrega una orden al viaje (estado BORRADOR), validando capacidad. No mueve stock. */
export function agregarOrdenAHoja(id: number, input: AgregarOrdenAHojaInput): Promise<{ hoja_de_ruta: HojaDeRuta }> {
  return apiFetch(`/hojas-de-ruta/${id}/ordenes`, { method: 'POST', body: input });
}

export function quitarOrdenDeHoja(id: number, idOrdenEntrega: number): Promise<{ hoja_de_ruta: HojaDeRuta }> {
  return apiFetch(`/hojas-de-ruta/${id}/ordenes/${idOrdenEntrega}`, { method: 'DELETE' });
}

/** Carga el COT (ARBA) del viaje completo. Sólo mientras la hoja está en BORRADOR. */
export function actualizarCotHojaDeRuta(id: number, input: ActualizarCotHojaInput): Promise<{ hoja_de_ruta: HojaDeRuta }> {
  return apiFetch(`/hojas-de-ruta/${id}/cot`, { method: 'PUT', body: input });
}

/** Confirma la salida: despacha TODO el viaje en lote (libera reservas, baja físico, genera remitos). */
export function confirmarSalida(id: number): Promise<{ hoja_de_ruta: HojaDeRuta }> {
  return apiFetch(`/hojas-de-ruta/${id}/confirmar-salida`, { method: 'POST', body: {} });
}

export function anularHojaDeRuta(id: number, input: AnularHojaDeRutaInput): Promise<{ hoja_de_ruta: HojaDeRuta }> {
  return apiFetch(`/hojas-de-ruta/${id}/anular`, { method: 'POST', body: input });
}
