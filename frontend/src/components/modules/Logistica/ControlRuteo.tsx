import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../api/client';
import { obtenerOcupacionDiaria } from '../../../api/logistica';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import type { CamionJornada, EnvioAsignado } from '../../../types/domain';
import { AsignarEnvioModal } from './AsignarEnvioModal';
import { GrillaRuteoCamiones } from './GrillaRuteoCamiones';

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Control de Ruteo y Ocupación Diaria (F4). */
export function ControlRuteo({ onSalir }: { onSalir: () => void }): JSX.Element {
  const [fecha, setFecha] = useState(hoyISO());
  const [camiones, setCamiones] = useState<CamionJornada[]>([]);
  const [asignarAbierto, setAsignarAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const cargarOcupacion = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await obtenerOcupacionDiaria(fecha);
      setCamiones(res.camiones);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la ocupación del día.');
    } finally {
      setCargando(false);
    }
  }, [fecha]);

  useEffect(() => {
    void cargarOcupacion();
  }, [cargarOcupacion]);

  useEffect(() => {
    if (!error && !mensaje) return;
    const t = setTimeout(() => {
      setError(null);
      setMensaje(null);
    }, 5000);
    return () => clearTimeout(t);
  }, [error, mensaje]);

  function onAsignado(envio: EnvioAsignado): void {
    setAsignarAbierto(false);
    setMensaje(`Remito #${envio.nro_remito} asignado a ${envio.cliente} (${envio.zona}).`);
    void cargarOcupacion();
  }

  useGlobalHotkeys({
    F1: () => setAsignarAbierto(true),
    Escape: () => {
      if (asignarAbierto) setAsignarAbierto(false);
      else onSalir();
    },
  });

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-white p-6">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-neutral-600">Fecha de despacho</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="rounded border border-neutral-300 px-3 py-1.5 focus:border-acento"
          />
        </label>
        <div className="text-xs text-neutral-400">F1 asignar envío · Esc volver</div>
      </div>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}
      {mensaje && <p className="rounded bg-green-50 px-3 py-2 text-sm text-exito">{mensaje}</p>}

      {cargando && camiones.length === 0 ? (
        <p className="text-sm text-neutral-400">Cargando…</p>
      ) : (
        <GrillaRuteoCamiones camiones={camiones} />
      )}

      {asignarAbierto && <AsignarEnvioModal fecha={fecha} onAsignado={onAsignado} />}
    </div>
  );
}
