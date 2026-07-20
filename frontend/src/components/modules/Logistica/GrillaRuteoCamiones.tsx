import type { CamionJornada } from '../../../types/domain';

interface GrillaRuteoCamionesProps {
  camiones: CamionJornada[];
  onSeleccionarCamion?: (idCamion: number) => void;
  camionResaltado?: number | null;
}

/**
 * Grilla modular de ocupación diaria: cada camión es una fila con sus
 * casilleros usados (uno por envío, con ancho proporcional a los
 * casilleros que consume la zona del cliente) y los casilleros libres
 * restantes, tal como se armó en la referencia de diseño provista.
 */
export function GrillaRuteoCamiones({ camiones, onSeleccionarCamion, camionResaltado }: GrillaRuteoCamionesProps): JSX.Element {
  return (
    <div className="space-y-4">
      {camiones.map((camion) => {
        const casillerosUsados = camion.envios.reduce((acc, e) => acc + e.casillerosRequeridos, 0);
        const casillerosLibres = Math.max(0, camion.capacidadCasilleros - casillerosUsados);
        const kilosUsados = Number(camion.envios.reduce((acc, e) => acc + e.kilosTotales, 0).toFixed(2));
        const resaltado = camionResaltado === camion.id_camion;

        return (
          <div
            key={camion.id_camion}
            onClick={() => onSeleccionarCamion?.(camion.id_camion)}
            className={`rounded-lg border bg-white p-5 shadow-sm ${
              onSeleccionarCamion ? 'cursor-pointer' : ''
            } ${resaltado ? 'border-acento ring-1 ring-acento' : 'border-neutral-300'}`}
          >
            <div className="mb-4 flex items-center justify-between border-b border-neutral-200 pb-3">
              <div>
                <span className="text-lg font-black text-neutral-900">{camion.chofer}</span>
                <span className="ml-3 rounded bg-neutral-200 px-2 py-1 font-mono text-sm text-neutral-700">
                  {camion.patente}
                </span>
              </div>
              <div className="flex gap-6 text-sm font-medium">
                <div>
                  Kilos:{' '}
                  <span className="font-mono font-bold">
                    {kilosUsados} / {camion.capacidadKilosMax} kg
                  </span>
                </div>
                <div>
                  Disponibilidad:{' '}
                  <span
                    className={`rounded px-2 py-0.5 font-mono font-bold ${
                      casillerosLibres > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {casillerosLibres} casilleros libres
                  </span>
                </div>
              </div>
            </div>

            <div className="grid h-20 grid-cols-10 gap-2 rounded-md border border-neutral-200 bg-neutral-100 p-2">
              {camion.envios.map((envio) => (
                <div
                  key={envio.id_envio}
                  style={{ gridColumn: `span ${envio.casillerosRequeridos} / span ${envio.casillerosRequeridos}` }}
                  className={`flex flex-col justify-between overflow-hidden rounded border p-2 ${
                    envio.casillerosRequeridos === 3
                      ? 'border-purple-300 bg-purple-100 text-purple-900'
                      : envio.casillerosRequeridos === 2
                        ? 'border-amber-300 bg-amber-100 text-amber-900'
                        : 'border-blue-300 bg-blue-100 text-blue-900'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="truncate text-xs font-bold uppercase">{envio.cliente}</span>
                    <span className="rounded bg-white/60 px-1 text-[10px] font-bold">{envio.zona}</span>
                  </div>
                  <div className="flex items-end justify-between font-mono text-[11px]">
                    <span>Remito #{envio.nro_remito ?? envio.id_documento}</span>
                    <span className="font-bold">{envio.kilosTotales} kg</span>
                  </div>
                </div>
              ))}

              {Array.from({ length: casillerosLibres }).map((_, idx) => (
                <div
                  key={`libre-${idx}`}
                  className="flex items-center justify-center rounded border-2 border-dashed border-neutral-300 bg-white text-xs font-medium text-neutral-400"
                >
                  Disponible
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {camiones.length === 0 && (
        <p className="rounded border border-dashed border-neutral-300 p-8 text-center text-neutral-400">
          No hay camiones cargados.
        </p>
      )}
    </div>
  );
}
