import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { obtenerDocumento } from '../../api/documentos';
import { anularRemito, generarRemito, listarRemitosPorDocumento } from '../../api/remitos';
import { facturarComprobanteInterno } from '../../api/ventas';
import { useGlobalHotkeys } from '../../hooks/useGlobalHotkeys';
import { resolverCantidadUnidades } from '../../utils/cantidad';
import type { Documento, Remito, UnidadIngresoCantidad } from '../../types/domain';
import { Modal } from '../common/Modal';

const ETIQUETA_ESTADO_REMITO: Record<Remito['estado'], string> = {
  EMITIDO: 'Emitido',
  EN_TRANSITO: 'En tránsito',
  ENTREGADO: 'Entregado',
  ANULADO: 'Anulado',
};

interface FichaDespachoProps {
  documentoInicial: Documento;
  onCerrar: () => void;
}

/**
 * Ficha de Despacho (F8 desde Historial): genera remitos de despacho
 * parcial/total, muestra el historial de remitos del documento con
 * anulación ágil (F2 — libera saldo para volver a generar con F1, "Baja +
 * Alta" en dos llamadas separadas como pide el épico), y permite convertir
 * un Comprobante Interno ya despachado en Factura fiscal (F6).
 */
export function FichaDespacho({ documentoInicial, onCerrar }: FichaDespachoProps): JSX.Element {
  const [documento, setDocumento] = useState(documentoInicial);
  const [remitos, setRemitos] = useState<Remito[]>([]);
  const [cantidades, setCantidades] = useState<Record<number, string>>({});
  const [unidadesIngreso, setUnidadesIngreso] = useState<Record<number, UnidadIngresoCantidad>>({});
  const [remitoFiltro, setRemitoFiltro] = useState('');
  const [remitoIndice, setRemitoIndice] = useState(0);
  const [motivoPromptAbierto, setMotivoPromptAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const motivoRef = useRef<HTMLInputElement>(null);

  async function refrescar(idDocumento: number): Promise<void> {
    const [{ documento: doc }, { remitos: lista }] = await Promise.all([
      obtenerDocumento(idDocumento),
      listarRemitosPorDocumento(idDocumento),
    ]);
    setDocumento(doc);
    setRemitos(lista);
  }

  useEffect(() => {
    void refrescar(documentoInicial.id_documento).catch((err) => {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar el detalle del documento.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arranca siempre en 'U': el valor precargado es el saldo pendiente, ya
  // expresado en unidades — si arrancara en 'KG' habría que convertirlo de
  // entrada. Al cambiar el selector de un ítem, `onCambiarUnidadIngreso`
  // reconvierte el valor ya tipeado para mantener la misma cantidad física.
  useEffect(() => {
    const defaults: Record<number, string> = {};
    const unidades: Record<number, UnidadIngresoCantidad> = {};
    for (const item of documento.items) {
      const saldo = item.cantidad - item.cantidad_despachada_total;
      defaults[item.id_producto] = saldo > 0 ? String(saldo) : '';
      unidades[item.id_producto] = 'U';
    }
    setCantidades(defaults);
    setUnidadesIngreso(unidades);
  }, [documento]);

  function onCambiarUnidadIngreso(item: Documento['items'][number], nuevaUnidad: UnidadIngresoCantidad): void {
    setUnidadesIngreso((u) => ({ ...u, [item.id_producto]: nuevaUnidad }));
    setCantidades((c) => {
      const actual = Number(c[item.id_producto] || 0);
      if (actual <= 0 || item.peso_teorico_kg <= 0) return c;
      const convertido = nuevaUnidad === 'KG' ? actual * item.peso_teorico_kg : actual / item.peso_teorico_kg;
      return { ...c, [item.id_producto]: String(Math.round(convertido * 100) / 100) };
    });
  }

  useEffect(() => {
    if (motivoPromptAbierto) motivoRef.current?.focus();
  }, [motivoPromptAbierto]);

  useEffect(() => {
    if (!error && !mensaje) return;
    const t = setTimeout(() => {
      setError(null);
      setMensaje(null);
    }, 6000);
    return () => clearTimeout(t);
  }, [error, mensaje]);

  const remitosFiltrados = useMemo(() => {
    const termino = remitoFiltro.trim().toLowerCase();
    if (!termino) return remitos;
    return remitos.filter((r) => (r.nro_remito ?? '').toLowerCase().includes(termino) || r.tipo_remito.toLowerCase() === termino);
  }, [remitos, remitoFiltro]);

  const remitoSeleccionado = remitosFiltrados[remitoIndice] ?? null;
  const remitoXActivo = remitos.find((r) => r.tipo_remito === 'X' && r.estado !== 'ANULADO') ?? null;
  const esCiPendiente = !documento.es_fiscal && documento.estado_facturacion_interna === 'PENDIENTE';

  async function onGenerarRemito(): Promise<void> {
    if (procesando) return;
    const itemsCargados = documento.items.filter((item) => Number(cantidades[item.id_producto] || 0) > 0);

    if (itemsCargados.length === 0) {
      setError('Cargá al menos una cantidad a despachar.');
      return;
    }

    for (const item of itemsCargados) {
      const unidadIngreso = unidadesIngreso[item.id_producto] ?? 'U';
      const resolucion = resolverCantidadUnidades(Number(cantidades[item.id_producto]), unidadIngreso, item.peso_teorico_kg);
      if (!resolucion.valido) {
        setError(`${item.descripcion}: ${resolucion.mensaje}`);
        return;
      }
      const saldo = item.cantidad - item.cantidad_despachada_total;
      if (resolucion.cantidadUnidades > saldo) {
        setError(`${item.descripcion}: supera el saldo pendiente (${saldo}).`);
        return;
      }
    }

    const items = itemsCargados.map((item) => ({
      id_producto: item.id_producto,
      cantidad: Number(cantidades[item.id_producto]),
      unidad_ingreso: unidadesIngreso[item.id_producto] ?? 'U',
    }));

    setProcesando(true);
    setError(null);
    try {
      const { remito } = await generarRemito({ id_documento: documento.id_documento, items });
      await refrescar(documento.id_documento);
      setMensaje(`Remito ${remito.nro_remito} generado.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo generar el remito.');
    } finally {
      setProcesando(false);
    }
  }

  async function onConfirmarAnulacion(): Promise<void> {
    if (!remitoSeleccionado || procesando || !motivo.trim()) return;
    setProcesando(true);
    setError(null);
    try {
      await anularRemito(remitoSeleccionado.id_remito, { motivo: motivo.trim() });
      await refrescar(documento.id_documento);
      setMensaje(`Remito ${remitoSeleccionado.nro_remito} anulado. Ajustá las cantidades y generá uno nuevo con F1.`);
      setMotivoPromptAbierto(false);
      setMotivo('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo anular el remito.');
    } finally {
      setProcesando(false);
    }
  }

  async function onFacturarInterno(): Promise<void> {
    if (procesando || !esCiPendiente) return;
    setProcesando(true);
    setError(null);
    try {
      const resultado = await facturarComprobanteInterno(documento.id_documento);
      setDocumento(resultado.documento);
      const remitosLista = await listarRemitosPorDocumento(resultado.documento.id_documento);
      setRemitos(remitosLista.remitos);
      const remitoR = resultado.remitos_regularizacion[0];
      setMensaje(
        remitoR
          ? `Factura ${resultado.documento.nro_remito} emitida. Remito Legal emitido en regularización de entrega según Remito Interno X N°${remitoXActivo?.nro_remito ?? ''} (Remito ${remitoR.nro_remito}).`
          : `Factura ${resultado.documento.nro_remito} emitida.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo facturar el Comprobante Interno.');
    } finally {
      setProcesando(false);
    }
  }

  function onKeyDownRemitos(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setRemitoIndice((i) => Math.min(i + 1, remitosFiltrados.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setRemitoIndice((i) => Math.max(i - 1, 0));
    }
  }

  useGlobalHotkeys({
    F1: () => {
      if (!motivoPromptAbierto) void onGenerarRemito();
    },
    F2: () => {
      if (!motivoPromptAbierto && remitoSeleccionado && (remitoSeleccionado.estado === 'EMITIDO' || remitoSeleccionado.estado === 'EN_TRANSITO')) {
        setMotivoPromptAbierto(true);
      }
    },
    F6: () => {
      if (!motivoPromptAbierto) void onFacturarInterno();
    },
    Escape: () => {
      if (motivoPromptAbierto) setMotivoPromptAbierto(false);
      else onCerrar();
    },
  });

  return (
    <Modal titulo={`Ficha de Despacho — Remito ${documento.nro_remito ?? documento.id_documento}`} ancho="xl">
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}
      {mensaje && <p className="mb-3 rounded bg-green-50 px-3 py-2 text-sm text-exito">{mensaje}</p>}

      <div className="mb-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Ítems del documento</p>
        {/* select-text explícito: permite copiar cantidades/descripciones con el mouse. */}
        <table className="w-full select-text text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="py-1.5">Producto</th>
              <th className="py-1.5 text-right">Cant. Comprada</th>
              <th className="py-1.5 text-right">Ya Despachado</th>
              <th className="py-1.5 text-right">A Despachar Hoy</th>
            </tr>
          </thead>
          <tbody>
            {documento.items.map((item) => {
              const saldo = item.cantidad - item.cantidad_despachada_total;
              const unidadIngreso = unidadesIngreso[item.id_producto] ?? 'U';
              const cantidadTexto = cantidades[item.id_producto] ?? '';
              const resolucion =
                cantidadTexto !== ''
                  ? resolverCantidadUnidades(Number(cantidadTexto), unidadIngreso, item.peso_teorico_kg)
                  : null;
              const excedeSaldo = resolucion?.valido && resolucion.cantidadUnidades > saldo;
              return (
                <tr key={item.id_producto} className="border-b border-neutral-100">
                  <td className="py-1.5">{item.descripcion}</td>
                  <td className="py-1.5 text-right font-mono">{item.cantidad}</td>
                  <td className="py-1.5 text-right font-mono">{item.cantidad_despachada_total}</td>
                  <td className="py-1.5 text-right">
                    {saldo > 0 ? (
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-1">
                          <div className="flex text-xs">
                            {(['U', 'KG'] as const).map((u) => (
                              <button
                                key={u}
                                type="button"
                                tabIndex={-1}
                                disabled={u === 'KG' && item.peso_teorico_kg <= 0}
                                onClick={() => onCambiarUnidadIngreso(item, u)}
                                className={`rounded border px-1.5 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${
                                  unidadIngreso === u ? 'border-acento bg-acento/10 text-acento' : 'border-neutral-300 text-neutral-500'
                                }`}
                              >
                                {u}
                              </button>
                            ))}
                          </div>
                          <input
                            type="number"
                            min={0}
                            value={cantidadTexto}
                            onChange={(e) => setCantidades((c) => ({ ...c, [item.id_producto]: e.target.value }))}
                            className={`w-24 rounded border px-2 py-1 text-right font-mono focus:border-acento ${
                              (resolucion && !resolucion.valido) || excedeSaldo ? 'border-peligro' : 'border-neutral-300'
                            }`}
                          />
                        </div>
                        {resolucion && !resolucion.valido && <span className="text-xs text-peligro">{resolucion.mensaje}</span>}
                        {excedeSaldo && (
                          <span className="text-xs text-peligro">Supera el saldo pendiente ({saldo}).</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-neutral-400">Completo</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mb-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Historial de remitos</p>
        <input
          value={remitoFiltro}
          onChange={(e) => {
            setRemitoFiltro(e.target.value);
            setRemitoIndice(0);
          }}
          onKeyDown={onKeyDownRemitos}
          placeholder="Filtrar por número o tipo (R/X)… (↑/↓ navega)"
          className="mb-2 w-full rounded border border-neutral-300 px-3 py-1.5 text-sm focus:border-acento"
        />
        <ul className="max-h-40 overflow-y-auto text-sm">
          {remitosFiltrados.map((r, i) => (
            <li
              key={r.id_remito}
              className={`flex justify-between rounded px-3 py-1.5 ${i === remitoIndice ? 'bg-acento/10 text-acento' : 'text-neutral-700'}`}
            >
              <span>
                {r.tipo_remito === 'R' ? 'Fiscal' : 'Interno'} {r.nro_remito}
                {r.es_regularizacion_stock && ' · regularización'}
              </span>
              <span className="text-neutral-400">{ETIQUETA_ESTADO_REMITO[r.estado]}</span>
            </li>
          ))}
          {remitosFiltrados.length === 0 && <li className="px-3 py-1.5 text-neutral-400">Sin remitos todavía.</li>}
        </ul>

        {motivoPromptAbierto && remitoSeleccionado && (
          <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-3">
            <p className="mb-2 text-sm text-amber-800">Anular remito {remitoSeleccionado.nro_remito} — motivo:</p>
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

      {esCiPendiente && (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm">
          <p className="text-neutral-700">
            La salida de stock ya fue registrada (Remito X Nro {remitoXActivo?.nro_remito ?? '—'}). Al facturar
            fiscalmente (F6) se emitirá la Factura y su Remito R sin duplicar el descuento de inventario.
          </p>
        </div>
      )}

      <p className="mt-4 text-xs text-neutral-400">
        F1 generar remito · F2 anular remito seleccionado{esCiPendiente ? ' · F6 facturar fiscalmente' : ''} · Esc para
        cerrar
      </p>
    </Modal>
  );
}
