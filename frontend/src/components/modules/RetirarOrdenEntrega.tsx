import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { anularOrdenEntrega, buscarOrdenEntrega, editarTipoEntregaOrden, retirarOrdenEntrega } from '../../api/ordenesEntrega';
import { useAuth } from '../../context/AuthContext';
import { useGlobalHotkeys } from '../../hooks/useGlobalHotkeys';
import type { EstadoOrdenEntrega, OrdenEntrega, TipoEntregaOrden } from '../../types/domain';

const ETIQUETA_ESTADO: Record<EstadoOrdenEntrega, string> = {
  PENDIENTE: 'Pendiente',
  RETIRADA: 'Retirada',
  ANULADA: 'Anulada',
};

const CLASE_ESTADO: Record<EstadoOrdenEntrega, string> = {
  PENDIENTE: 'bg-acento/10 text-acento',
  RETIRADA: 'bg-green-50 text-exito',
  ANULADA: 'bg-neutral-100 text-neutral-500',
};

/** Timestamp completo (fecha_creacion / fecha_retiro). */
function fmtFechaHora(valor: string | null): string {
  if (!valor) return '—';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? valor : d.toLocaleString('es-AR');
}

/** Fecha sola (fecha_pactada_envio, que llega como DATE). */
function fmtFecha(valor: string | null): string {
  if (!valor) return '—';
  return valor.slice(0, 10);
}

/**
 * Retirar Orden de Entrega (F6 desde Punto Muerto). El cliente vuelve al
 * mostrador con el número de su Orden de Entrega Pendiente; el operador la
 * busca, ve el detalle y la retira (o la anula). El retiro se ejecuta desde
 * la sucursal del operador: si la orden se generó en otra, es un despacho
 * cruzado (el stock sale de acá). Todo-o-nada por renglón.
 */
export function RetirarOrdenEntrega({ onSalir }: { onSalir: () => void }): JSX.Element {
  const { sucursal } = useAuth();
  const [nroInput, setNroInput] = useState('');
  const [orden, setOrden] = useState<OrdenEntrega | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [motivoPromptAbierto, setMotivoPromptAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');

  // --- Editar intención de entrega (F3, caso "flete pagado aparte") ---
  const [editarEntregaAbierto, setEditarEntregaAbierto] = useState(false);
  const [tipoEntregaEditado, setTipoEntregaEditado] = useState<TipoEntregaOrden>('RETIRO_CLIENTE');
  const [direccionEditada, setDireccionEditada] = useState('');
  const [fechaEditada, setFechaEditada] = useState('');
  const [marcarFaltantes, setMarcarFaltantes] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const motivoRef = useRef<HTMLInputElement>(null);
  const direccionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (motivoPromptAbierto) motivoRef.current?.focus();
  }, [motivoPromptAbierto]);

  useEffect(() => {
    if (editarEntregaAbierto && tipoEntregaEditado === 'ENVIO_DOMICILIO') direccionRef.current?.focus();
  }, [editarEntregaAbierto, tipoEntregaEditado]);

  useEffect(() => {
    if (!error && !mensaje) return;
    const t = setTimeout(() => {
      setError(null);
      setMensaje(null);
    }, 6000);
    return () => clearTimeout(t);
  }, [error, mensaje]);

  async function buscar(): Promise<void> {
    const nro = nroInput.trim();
    if (!nro || buscando) return;
    setBuscando(true);
    setError(null);
    setMensaje(null);
    setMotivoPromptAbierto(false);
    setEditarEntregaAbierto(false);
    try {
      const { orden_entrega } = await buscarOrdenEntrega(nro);
      setOrden(orden_entrega);
    } catch (err) {
      setOrden(null);
      setError(err instanceof ApiError ? err.message : 'No se pudo buscar la orden de entrega.');
    } finally {
      setBuscando(false);
    }
  }

  async function onRetirar(): Promise<void> {
    if (!orden || procesando || orden.estado !== 'PENDIENTE') return;
    setProcesando(true);
    setError(null);
    try {
      const { orden_entrega } = await retirarOrdenEntrega(orden.nro_orden ?? '');
      setOrden(orden_entrega);
      setMensaje(`Orden ${orden_entrega.nro_orden} retirada. Mercadería entregada.`);
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo retirar la orden.');
    } finally {
      setProcesando(false);
    }
  }

  async function onConfirmarAnulacion(): Promise<void> {
    if (!orden || procesando || !motivo.trim()) return;
    setProcesando(true);
    setError(null);
    try {
      const { orden_entrega } = await anularOrdenEntrega(orden.nro_orden ?? '', { motivo: motivo.trim() });
      setOrden(orden_entrega);
      setMensaje(`Orden ${orden_entrega.nro_orden} anulada. Reserva liberada.`);
      setMotivoPromptAbierto(false);
      setMotivo('');
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo anular la orden.');
    } finally {
      setProcesando(false);
    }
  }

  function abrirEditarEntrega(): void {
    if (!orden) return;
    setTipoEntregaEditado(orden.tipo_entrega);
    setDireccionEditada(orden.direccion_envio ?? '');
    setFechaEditada(orden.fecha_pactada_envio?.slice(0, 10) ?? '');
    setMarcarFaltantes(false);
    setEditarEntregaAbierto(true);
  }

  async function onConfirmarEdicionEntrega(): Promise<void> {
    if (!orden || procesando) return;
    if (tipoEntregaEditado === 'ENVIO_DOMICILIO' && (!direccionEditada.trim() || !fechaEditada)) {
      setMarcarFaltantes(true);
      setError('Para un envío a domicilio, la dirección y la fecha pactada son obligatorias.');
      return;
    }
    setProcesando(true);
    setError(null);
    try {
      const { orden_entrega } = await editarTipoEntregaOrden(orden.nro_orden ?? '', {
        tipo_entrega: tipoEntregaEditado,
        direccion_envio: tipoEntregaEditado === 'ENVIO_DOMICILIO' ? direccionEditada.trim() : undefined,
        fecha_pactada_envio: tipoEntregaEditado === 'ENVIO_DOMICILIO' ? fechaEditada : undefined,
      });
      setOrden(orden_entrega);
      setMensaje(
        orden_entrega.tipo_entrega === 'ENVIO_DOMICILIO'
          ? `Orden ${orden_entrega.nro_orden} pasada a envío a domicilio. Ya aparece en el backlog de la Pizarra de Camiones.`
          : `Orden ${orden_entrega.nro_orden} pasada a retiro en mostrador.`,
      );
      setEditarEntregaAbierto(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo editar la intención de entrega.');
    } finally {
      setProcesando(false);
    }
  }

  const esPendiente = orden?.estado === 'PENDIENTE';

  useGlobalHotkeys({
    F1: () => {
      if (!motivoPromptAbierto && !editarEntregaAbierto && esPendiente) void onRetirar();
    },
    F2: () => {
      if (!motivoPromptAbierto && !editarEntregaAbierto && esPendiente) setMotivoPromptAbierto(true);
    },
    F3: () => {
      if (!motivoPromptAbierto && esPendiente) {
        if (editarEntregaAbierto) void onConfirmarEdicionEntrega();
        else abrirEditarEntrega();
      }
    },
    Escape: () => {
      if (motivoPromptAbierto) setMotivoPromptAbierto(false);
      else if (editarEntregaAbierto) setEditarEntregaAbierto(false);
      else onSalir();
    },
  });

  const sucursalActualId = sucursal?.id_sucursal ?? null;
  const esCruzado = orden != null && sucursalActualId != null && orden.id_sucursal_origen !== sucursalActualId;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-white p-6">
      <div>
        <label className="block w-72 text-sm">
          <span className="mb-1 block text-neutral-600">Número de Orden de Entrega</span>
          <input
            ref={inputRef}
            value={nroInput}
            onChange={(e) => setNroInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void buscar()}
            placeholder="OE-1-000042 · Enter para buscar"
            className="w-full rounded border border-neutral-300 px-3 py-2 font-mono focus:border-acento"
          />
        </label>
      </div>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}
      {mensaje && <p className="rounded bg-green-50 px-3 py-2 text-sm text-exito">{mensaje}</p>}

      {!orden && !error && (
        <div className="flex flex-1 items-center justify-center text-neutral-400">
          Ingresá el número de orden que trae el cliente y presioná Enter.
        </div>
      )}

      {orden && (
        <div className="rounded-lg border border-neutral-200">
          {/* Cabecera de la orden */}
          <div className="flex flex-wrap items-center gap-3 border-b border-neutral-200 px-4 py-3">
            <span className="font-mono text-lg font-semibold text-neutral-900">{orden.nro_orden}</span>
            <span className={`rounded px-2 py-1 text-xs font-medium ${CLASE_ESTADO[orden.estado]}`}>
              {ETIQUETA_ESTADO[orden.estado]}
            </span>
            <span className="rounded bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600">
              {orden.tipo_entrega === 'ENVIO_DOMICILIO' ? 'Envío a domicilio' : 'Retiro en mostrador'}
            </span>
            <span className="ml-auto text-xs text-neutral-500">
              Cliente #{orden.cliente_id} · creada {fmtFechaHora(orden.fecha_creacion)}
            </span>
          </div>

          {/* Datos de envío, si corresponde */}
          {orden.tipo_entrega === 'ENVIO_DOMICILIO' && (
            <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-sm text-neutral-600">
              <span className="font-medium text-neutral-700">Envío pactado:</span> {orden.direccion_envio ?? '—'} · para el{' '}
              {fmtFecha(orden.fecha_pactada_envio)}
            </div>
          )}

          {/* Aviso de despacho cruzado */}
          {esPendiente && esCruzado && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              Esta orden se generó en otra sucursal (#{orden.id_sucursal_origen}). Al retirarla acá, el stock sale de{' '}
              <span className="font-medium">{sucursal?.nombre ?? 'esta sucursal'}</span> (despacho cruzado).
            </div>
          )}

          {/* Editar intención de entrega — F3, caso "flete pagado aparte" */}
          {esPendiente && editarEntregaAbierto && (
            <div className="border-b border-acento/30 bg-acento/5 p-3">
              <p className="mb-2 text-sm font-medium text-neutral-700">
                Cambiar cómo se cumple la orden {orden.nro_orden}
              </p>
              <div className="flex gap-2">
                {(
                  [
                    ['RETIRO_CLIENTE', 'Retiro en mostrador'],
                    ['ENVIO_DOMICILIO', 'Envío a domicilio'],
                  ] as Array<[TipoEntregaOrden, string]>
                ).map(([valor, etiqueta]) => (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => {
                      setTipoEntregaEditado(valor);
                      setMarcarFaltantes(false);
                    }}
                    className={`flex-1 rounded border px-3 py-1.5 text-sm font-medium ${
                      tipoEntregaEditado === valor
                        ? 'border-acento bg-acento/10 text-acento'
                        : 'border-neutral-300 text-neutral-600 hover:border-neutral-400'
                    }`}
                  >
                    {etiqueta}
                  </button>
                ))}
              </div>

              {tipoEntregaEditado === 'ENVIO_DOMICILIO' && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-neutral-600">
                      Dirección de envío <span className="text-peligro">*</span>
                    </span>
                    <input
                      ref={direccionRef}
                      value={direccionEditada}
                      onChange={(e) => {
                        setDireccionEditada(e.target.value);
                        setMarcarFaltantes(false);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && void onConfirmarEdicionEntrega()}
                      placeholder="Calle, número, localidad…"
                      className={`w-full rounded border px-3 py-2 focus:border-acento ${
                        marcarFaltantes && !direccionEditada.trim() ? 'border-peligro bg-red-50' : 'border-neutral-300'
                      }`}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-neutral-600">
                      Fecha pactada <span className="text-peligro">*</span>
                    </span>
                    <input
                      type="date"
                      value={fechaEditada}
                      onChange={(e) => {
                        setFechaEditada(e.target.value);
                        setMarcarFaltantes(false);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && void onConfirmarEdicionEntrega()}
                      className={`w-full rounded border px-3 py-2 focus:border-acento ${
                        marcarFaltantes && !fechaEditada ? 'border-peligro bg-red-50' : 'border-neutral-300'
                      }`}
                    />
                  </label>
                </div>
              )}

              <p className="mt-3 text-xs text-neutral-400">F3 confirma · Esc cancela</p>
            </div>
          )}

          {/* Detalle */}
          <table className="w-full select-text text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2 text-right">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {orden.detalles.map((d) => (
                <tr key={d.id_orden_entrega_detalle} className="border-b border-neutral-100">
                  <td className="px-4 py-2">
                    {d.descripcion}
                    <span className="ml-2 font-mono text-xs text-neutral-400">{d.sku}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{d.cantidad}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Estado terminal: retirada o anulada */}
          {orden.estado === 'RETIRADA' && (
            <div className="border-t border-neutral-100 px-4 py-2 text-sm text-neutral-600">
              Retirada el {fmtFechaHora(orden.fecha_retiro)} en sucursal #{orden.id_sucursal_retiro} · Remito #
              {orden.id_remito_retiro}
            </div>
          )}
          {orden.estado === 'ANULADA' && (
            <div className="border-t border-neutral-100 px-4 py-2 text-sm text-neutral-600">
              Anulada el {fmtFechaHora(orden.fecha_anulacion)} · Motivo: {orden.motivo_anulacion ?? '—'}
            </div>
          )}

          {/* Prompt de anulación */}
          {motivoPromptAbierto && (
            <div className="border-t border-amber-200 bg-amber-50 p-3">
              <p className="mb-2 text-sm text-amber-800">Anular orden {orden.nro_orden} — motivo:</p>
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

      <p className="mt-auto text-xs text-neutral-400">
        {esPendiente
          ? editarEntregaAbierto
            ? 'F3 confirma el cambio · Esc cancela'
            : 'F1 retirar (entregar) · F2 anular · F3 cambiar retiro/envío · Esc para volver'
          : orden
            ? 'Orden ya cerrada · Buscá otra o Esc para volver'
            : 'Enter busca la orden · Esc para volver'}
      </p>
    </div>
  );
}
