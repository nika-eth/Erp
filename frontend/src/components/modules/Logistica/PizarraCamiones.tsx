import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';
import {
  actualizarCotHojaDeRuta,
  agregarOrdenAHoja,
  anularHojaDeRuta,
  confirmarSalida,
  crearHojaDeRuta,
  listarBacklog,
  quitarOrdenDeHoja,
} from '../../../api/hojasDeRuta';
import { listarCamiones } from '../../../api/logistica';
import { useAuth } from '../../../context/AuthContext';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import type { Camion, EstadoHojaDeRuta, HojaDeRuta, OrdenEntregaBacklog } from '../../../types/domain';

const ETIQUETA_ESTADO: Record<EstadoHojaDeRuta, string> = {
  BORRADOR: 'Borrador',
  EN_TRANSITO: 'En tránsito',
  ANULADA: 'Anulada',
};

const CLASE_ESTADO: Record<EstadoHojaDeRuta, string> = {
  BORRADOR: 'bg-acento/10 text-acento',
  EN_TRANSITO: 'bg-green-50 text-exito',
  ANULADA: 'bg-neutral-100 text-neutral-500',
};

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Barra de ocupación (kilos o casilleros) usados vs. capacidad del camión. */
function BarraCapacidad({ etiqueta, usado, maximo, unidad }: { etiqueta: string; usado: number; maximo: number; unidad: string }): JSX.Element {
  const pct = maximo > 0 ? Math.min(100, (usado / maximo) * 100) : 0;
  const excedido = usado > maximo;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-neutral-500">{etiqueta}</span>
        <span className={`font-mono ${excedido ? 'text-peligro' : 'text-neutral-600'}`}>
          {usado} / {maximo} {unidad}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <div className={`h-full rounded-full ${excedido ? 'bg-peligro' : 'bg-acento'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Pizarra de Camiones (F10). Arma Hojas de Ruta para despachar las Órdenes
 * de Entrega de envío a domicilio. El viaje se construye en BORRADOR
 * (agregar/quitar órdenes con control de capacidad, sin mover stock) y recién
 * al confirmar la salida se despacha todo en lote. Convive con el Control de
 * Ruteo (F4): son circuitos paralelos.
 *
 * Nota: el backend no expone un listado de hojas de ruta, así que la pantalla
 * es un banco de trabajo de UNA hoja por vez — se crea, se arma y se
 * confirma/anula en la misma sesión.
 */
export function PizarraCamiones({ onSalir }: { onSalir: () => void }): JSX.Element {
  const { sucursal } = useAuth();
  const [camiones, setCamiones] = useState<Camion[]>([]);
  const [backlog, setBacklog] = useState<OrdenEntregaBacklog[]>([]);
  const [hoja, setHoja] = useState<HojaDeRuta | null>(null);

  const [crearFormAbierto, setCrearFormAbierto] = useState(false);
  const [idCamion, setIdCamion] = useState('');
  const [chofer, setChofer] = useState('');
  const [fecha, setFecha] = useState(hoyISO());

  const [motivoPromptAbierto, setMotivoPromptAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');

  const [cotInput, setCotInput] = useState('');

  const [cargando, setCargando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const motivoRef = useRef<HTMLInputElement>(null);

  async function cargarBacklog(): Promise<void> {
    const { ordenes } = await listarBacklog();
    setBacklog(ordenes);
  }

  useEffect(() => {
    setCargando(true);
    Promise.all([listarCamiones(), listarBacklog()])
      .then(([c, b]) => {
        setCamiones(c.camiones);
        setBacklog(b.ordenes);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar la pizarra.'))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    if (motivoPromptAbierto) motivoRef.current?.focus();
  }, [motivoPromptAbierto]);

  useEffect(() => {
    setCotInput(hoja?.nro_cot ?? '');
  }, [hoja?.id_hoja_de_ruta, hoja?.nro_cot]);

  useEffect(() => {
    if (!error && !mensaje) return;
    const t = setTimeout(() => {
      setError(null);
      setMensaje(null);
    }, 6000);
    return () => clearTimeout(t);
  }, [error, mensaje]);

  const camionDeLaHoja = useMemo(
    () => (hoja ? camiones.find((c) => c.id_camion === hoja.id_camion) ?? null : null),
    [hoja, camiones],
  );

  const kilosUsados = useMemo(
    () => (hoja ? Math.round(hoja.ordenes.reduce((acc, o) => acc + o.kilosAsignados, 0) * 100) / 100 : 0),
    [hoja],
  );
  const casillerosUsados = useMemo(() => (hoja ? hoja.ordenes.reduce((acc, o) => acc + o.casillerosOcupados, 0) : 0), [hoja]);

  function onSeleccionarCamion(valor: string): void {
    setIdCamion(valor);
    const c = camiones.find((cam) => cam.id_camion === Number(valor));
    if (c) setChofer(c.chofer);
  }

  async function onCrearHoja(): Promise<void> {
    if (procesando) return;
    if (!Number.isInteger(Number(idCamion)) || Number(idCamion) <= 0) {
      setError('Elegí un camión para la hoja de ruta.');
      return;
    }
    setProcesando(true);
    setError(null);
    try {
      const { hoja_de_ruta } = await crearHojaDeRuta({ id_camion: Number(idCamion), chofer: chofer.trim() || null, fecha_despacho: fecha });
      setHoja(hoja_de_ruta);
      setCrearFormAbierto(false);
      setMensaje(`Hoja de ruta #${hoja_de_ruta.id_hoja_de_ruta} creada. Agregá las órdenes del backlog.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear la hoja de ruta.');
    } finally {
      setProcesando(false);
    }
  }

  async function onAgregar(orden: OrdenEntregaBacklog): Promise<void> {
    if (!hoja || procesando || !orden.nro_orden) return;
    setProcesando(true);
    setError(null);
    try {
      const { hoja_de_ruta } = await agregarOrdenAHoja(hoja.id_hoja_de_ruta, {
        nro_orden: orden.nro_orden,
        id_sucursal_despacho: sucursal?.id_sucursal ?? 0,
      });
      setHoja(hoja_de_ruta);
      await cargarBacklog();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo agregar la orden al viaje.');
    } finally {
      setProcesando(false);
    }
  }

  async function onQuitar(idOrdenEntrega: number): Promise<void> {
    if (!hoja || procesando) return;
    setProcesando(true);
    setError(null);
    try {
      const { hoja_de_ruta } = await quitarOrdenDeHoja(hoja.id_hoja_de_ruta, idOrdenEntrega);
      setHoja(hoja_de_ruta);
      await cargarBacklog();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo quitar la orden del viaje.');
    } finally {
      setProcesando(false);
    }
  }

  async function onGuardarCot(): Promise<void> {
    if (!hoja || procesando) return;
    if (!cotInput.trim()) {
      setError('El COT es requerido para confirmar la salida del camión.');
      return;
    }
    setProcesando(true);
    setError(null);
    try {
      const { hoja_de_ruta } = await actualizarCotHojaDeRuta(hoja.id_hoja_de_ruta, { nro_cot: cotInput.trim() });
      setHoja(hoja_de_ruta);
      setMensaje(`COT ${hoja_de_ruta.nro_cot} cargado para la hoja #${hoja_de_ruta.id_hoja_de_ruta}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar el COT.');
    } finally {
      setProcesando(false);
    }
  }

  async function onConfirmarSalida(): Promise<void> {
    if (!hoja || procesando || hoja.ordenes.length === 0) return;
    if (!hoja.nro_cot?.trim()) {
      setError('Cargá el COT del viaje (ARBA) antes de confirmar la salida.');
      return;
    }
    setProcesando(true);
    setError(null);
    try {
      const { hoja_de_ruta } = await confirmarSalida(hoja.id_hoja_de_ruta);
      setMensaje(`Hoja #${hoja_de_ruta.id_hoja_de_ruta} despachada: ${hoja_de_ruta.ordenes.length} orden(es) en ruta.`);
      setHoja(null);
      await cargarBacklog();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo confirmar la salida.');
    } finally {
      setProcesando(false);
    }
  }

  async function onConfirmarAnulacion(): Promise<void> {
    if (!hoja || procesando || !motivo.trim()) return;
    setProcesando(true);
    setError(null);
    try {
      const { hoja_de_ruta } = await anularHojaDeRuta(hoja.id_hoja_de_ruta, { motivo: motivo.trim() });
      setMensaje(`Hoja #${hoja_de_ruta.id_hoja_de_ruta} anulada. Las órdenes vuelven al backlog.`);
      setHoja(null);
      setMotivoPromptAbierto(false);
      setMotivo('');
      await cargarBacklog();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo anular la hoja de ruta.');
    } finally {
      setProcesando(false);
    }
  }

  const editable = hoja?.estado === 'BORRADOR';

  useGlobalHotkeys(
    {
      F1: () => {
        if (!hoja) setCrearFormAbierto(true);
      },
      F2: () => {
        if (editable && (hoja?.ordenes.length ?? 0) > 0) void onConfirmarSalida();
      },
      F4: () => {
        if (editable) setMotivoPromptAbierto(true);
      },
    },
    !crearFormAbierto && !motivoPromptAbierto,
  );

  useGlobalHotkeys({
    Escape: () => {
      if (crearFormAbierto) setCrearFormAbierto(false);
      else if (motivoPromptAbierto) setMotivoPromptAbierto(false);
      else if (hoja) setHoja(null);
      else onSalir();
    },
  });

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-neutral-900">Pizarra de Camiones</h2>
        <div className="text-xs text-neutral-400">
          {hoja
            ? 'F2 confirmar salida · F4 anular hoja · Esc volver'
            : 'F1 crear hoja de ruta · Esc volver'}
        </div>
      </div>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}
      {mensaje && <p className="rounded bg-green-50 px-3 py-2 text-sm text-exito">{mensaje}</p>}

      {/* Formulario de creación */}
      {crearFormAbierto && !hoja && (
        <div className="rounded-lg border border-acento/40 bg-acento/5 p-4">
          <p className="mb-3 text-sm font-medium text-neutral-700">Nueva Hoja de Ruta</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-neutral-600">Camión</span>
              <select
                value={idCamion}
                onChange={(e) => onSeleccionarCamion(e.target.value)}
                className="w-64 rounded border border-neutral-300 px-3 py-2 focus:border-acento"
              >
                <option value="">Elegí un camión…</option>
                {camiones.map((c) => (
                  <option key={c.id_camion} value={c.id_camion}>
                    {c.patente} · {c.chofer} · {Number(c.capacidad_kilos_max)}kg / {c.capacidad_casilleros} cas.
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-neutral-600">Chofer</span>
              <input
                value={chofer}
                onChange={(e) => setChofer(e.target.value)}
                placeholder="Chofer del viaje"
                className="w-48 rounded border border-neutral-300 px-3 py-2 focus:border-acento"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-neutral-600">Fecha de despacho</span>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void onCrearHoja()}
                className="rounded border border-neutral-300 px-3 py-2 focus:border-acento"
              />
            </label>
            <button
              type="button"
              onClick={() => void onCrearHoja()}
              disabled={procesando}
              className="rounded bg-acento px-4 py-2 text-sm font-medium text-white hover:bg-acento/90 disabled:opacity-50"
            >
              Crear
            </button>
          </div>
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Columna izquierda: la hoja activa */}
        <div className="rounded-lg border border-neutral-200">
          <div className="border-b border-neutral-200 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Hoja de ruta en armado</p>
          </div>

          {!hoja ? (
            <div className="flex h-48 items-center justify-center px-4 text-center text-sm text-neutral-400">
              No hay ninguna hoja en armado. Presioná F1 para crear una nueva.
            </div>
          ) : (
            <div className="p-4">
              {/* Cabecera de la hoja */}
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm font-semibold text-neutral-900">Hoja #{hoja.id_hoja_de_ruta}</span>
                <span className={`rounded px-2 py-1 text-xs font-medium ${CLASE_ESTADO[hoja.estado]}`}>
                  {ETIQUETA_ESTADO[hoja.estado]}
                </span>
                {camionDeLaHoja && (
                  <span className="text-sm text-neutral-600">
                    {camionDeLaHoja.patente} · {hoja.chofer ?? camionDeLaHoja.chofer}
                  </span>
                )}
                <span className="ml-auto text-xs text-neutral-500">Despacho: {hoja.fecha_despacho.slice(0, 10)}</span>
              </div>

              {/* Capacidad */}
              {camionDeLaHoja && (
                <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <BarraCapacidad etiqueta="Kilos" usado={kilosUsados} maximo={Number(camionDeLaHoja.capacidad_kilos_max)} unidad="kg" />
                  <BarraCapacidad etiqueta="Casilleros" usado={casillerosUsados} maximo={camionDeLaHoja.capacidad_casilleros} unidad="" />
                </div>
              )}

              {/* Órdenes del viaje */}
              {hoja.ordenes.length === 0 ? (
                <p className="py-6 text-center text-sm text-neutral-400">
                  Sin órdenes en el viaje. Agregá desde el backlog de la derecha.
                </p>
              ) : (
                <ul className="divide-y divide-neutral-100 text-sm">
                  {hoja.ordenes.map((o) => (
                    <li key={o.id_hoja_de_ruta_orden} className="flex items-center gap-2 py-2">
                      <span className="font-mono text-xs text-neutral-500">{o.nro_orden}</span>
                      <span className="text-neutral-700">{o.cliente}</span>
                      <span className="ml-auto font-mono text-xs text-neutral-500">
                        {o.kilosAsignados}kg · {o.casillerosOcupados} cas.
                      </span>
                      {editable && (
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => void onQuitar(o.id_orden_entrega)}
                          title="Quitar del viaje"
                          className="text-neutral-400 hover:text-peligro"
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* COT del viaje (ARBA) — se carga una vez por hoja, requerido antes de confirmar salida */}
              {hoja.ordenes.length > 0 && (
                <div className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Código de Operación de Traslado (COT)
                  </p>
                  {editable ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={cotInput}
                        onChange={(e) => setCotInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void onGuardarCot()}
                        placeholder="Nº de COT (ARBA)"
                        className={`flex-1 rounded border px-3 py-1.5 text-sm font-mono focus:border-acento ${
                          !hoja.nro_cot ? 'border-amber-300 bg-amber-50' : 'border-neutral-300'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => void onGuardarCot()}
                        disabled={procesando}
                        className="whitespace-nowrap rounded border border-acento px-3 py-1.5 text-xs font-medium text-acento hover:bg-acento/10 disabled:opacity-50"
                      >
                        Guardar COT
                      </button>
                    </div>
                  ) : (
                    <p className="font-mono text-sm text-neutral-700">{hoja.nro_cot ?? '—'}</p>
                  )}
                  {editable && !hoja.nro_cot && (
                    <p className="mt-1.5 text-xs text-amber-700">Requerido antes de confirmar la salida (F2).</p>
                  )}
                </div>
              )}

              {/* Prompt de anulación */}
              {motivoPromptAbierto && (
                <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3">
                  <p className="mb-2 text-sm text-amber-800">Anular hoja #{hoja.id_hoja_de_ruta} — motivo:</p>
                  <input
                    ref={motivoRef}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void onConfirmarAnulacion()}
                    placeholder="Enter para confirmar, Esc para cancelar"
                    className="w-full rounded border border-amber-300 px-3 py-1.5 text-sm focus:border-acento"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Columna derecha: el backlog */}
        <div className="rounded-lg border border-neutral-200">
          <div className="border-b border-neutral-200 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Backlog de envíos a domicilio ({backlog.length})
            </p>
          </div>
          {cargando ? (
            <p className="px-4 py-6 text-sm text-neutral-400">Cargando…</p>
          ) : backlog.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-neutral-400">No hay envíos pendientes de asignar.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {backlog.map((o) => (
                <li key={o.id_orden_entrega} className="flex items-start gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-neutral-500">{o.nro_orden}</span>
                      <span className="text-neutral-700">{o.cliente}</span>
                    </div>
                    <div className="truncate text-xs text-neutral-500">
                      {o.direccion_envio ?? 'Sin dirección'}
                      {o.fecha_pactada_envio ? ` · para ${o.fecha_pactada_envio.slice(0, 10)}` : ''}
                    </div>
                    <div className="font-mono text-xs text-neutral-400">
                      {o.kilosTotales}kg · {o.casillerosRequeridos ?? '—'} cas. · {o.zona ?? 'sin zona'}
                    </div>
                  </div>
                  {editable && (
                    <button
                      type="button"
                      onClick={() => void onAgregar(o)}
                      disabled={procesando}
                      className="whitespace-nowrap rounded border border-acento px-2.5 py-1 text-xs font-medium text-acento hover:bg-acento/10 disabled:opacity-50"
                    >
                      + Agregar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!editable && hoja == null && backlog.length > 0 && (
            <p className="border-t border-neutral-100 px-4 py-2 text-xs text-neutral-400">
              Creá una hoja de ruta (F1) para poder asignar estos envíos a un camión.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
