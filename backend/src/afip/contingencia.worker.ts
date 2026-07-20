import { withTransaction } from '../config/db';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { calcularNetoEIva, consultarSiYaFueProcesado, solicitarCaeParaDocumento } from './afip.service';
import { aplicarResultadoTarea, tomarTareaPorId, tomarTareasPendientes, type TareaConDocumento } from './cola.repository';
import { docTipoAfip } from './types';

/**
 * Procesa una tarea de la cola: si ya tenía un número AFIP reservado de un
 * intento anterior, primero confirma por `FECompConsultar` que AFIP no lo
 * haya procesado igual pese al timeout (idempotencia); si no hay nada que
 * confirmar (o AFIP no tiene registro), reintenta `FECAESolicitar` de cero
 * dentro de una transacción corta propia del worker.
 */
export async function procesarTarea(tarea: TareaConDocumento): Promise<void> {
  if (tarea.nro_comprobante_afip !== null) {
    const consulta = await consultarSiYaFueProcesado(tarea.punto_venta, tarea.tipo_comprobante, tarea.nro_comprobante_afip);
    if (consulta.estado === 'PROCESADO') {
      await withTransaction((client) =>
        aplicarResultadoTarea(client, tarea.id_tarea, tarea.id_documento, tarea.reintentos, env.afip.maxReintentos, consulta.resultado),
      );
      return;
    }
    if (consulta.estado === 'ERROR') {
      await withTransaction((client) =>
        aplicarResultadoTarea(client, tarea.id_tarea, tarea.id_documento, tarea.reintentos, env.afip.maxReintentos, {
          ok: false,
          tipo: 'CONTINGENCIA',
          mensaje: consulta.mensaje,
          nroComprobanteAfip: tarea.nro_comprobante_afip,
        }),
      );
      return;
    }
    // estado === 'NO_ENCONTRADO': sigue de largo y reintenta FECAESolicitar
    // reutilizando el mismo número ya reservado.
  }

  const { neto, iva } = calcularNetoEIva(Number(tarea.total_neto));
  const resultado = await withTransaction((client) =>
    solicitarCaeParaDocumento(client, {
      id_documento: tarea.id_documento,
      puntoVenta: tarea.punto_venta,
      tipoComprobante: tarea.tipo_comprobante,
      docTipo: docTipoAfip(tarea.cuit_dni),
      docNro: tarea.cuit_dni.replace(/\D/g, ''),
      importeTotal: Number(tarea.total_neto),
      importeNeto: neto,
      importeIva: iva,
      nroComprobanteAfipPrevio: tarea.nro_comprobante_afip,
    }),
  );

  await withTransaction((client) =>
    aplicarResultadoTarea(client, tarea.id_tarea, tarea.id_documento, tarea.reintentos, env.afip.maxReintentos, resultado),
  );
}

/** Un ciclo del worker: toma un lote de tareas vencidas y las procesa secuencialmente (AFIP es sensible a concurrencia sobre la misma numeración). */
export async function ejecutarCicloContingencia(): Promise<void> {
  const tareas = await tomarTareasPendientes();
  for (const tarea of tareas) {
    try {
      await procesarTarea(tarea);
    } catch (err) {
      console.error(`[afip-worker] Error inesperado procesando tarea ${tarea.id_tarea}`, err);
    }
  }
}

/** Dispara el reintento de una tarea puntual fuera de ciclo (botón manual del panel de administración). */
export async function reintentarTareaAhora(id_tarea: number): Promise<void> {
  const tarea = await tomarTareaPorId(id_tarea);
  if (!tarea) {
    throw AppError.notFound('TAREA_AFIP_NO_ENCONTRADA', `No hay una tarea PENDIENTE con id_tarea=${id_tarea}.`);
  }
  await procesarTarea(tarea);
}

let intervalo: ReturnType<typeof setInterval> | null = null;

/** Arranca el poller en segundo plano. Llamar una sola vez desde `server.ts`. */
export function iniciarWorkerAfip(): void {
  if (intervalo) return;
  intervalo = setInterval(() => {
    void ejecutarCicloContingencia();
  }, env.afip.workerIntervalMs);
  intervalo.unref?.();
}

export function detenerWorkerAfip(): void {
  if (intervalo) clearInterval(intervalo);
  intervalo = null;
}
