import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';
import { listarCuentasEmpresa } from '../../../api/catalogos';
import { facturarVenta, procesarVentaMixta } from '../../../api/ventas';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import { Modal } from '../../common/Modal';
import { PinInput } from '../../common/PinInput';
import type {
  CuentaEmpresa,
  ItemCarrito,
  ItemVentaMixtaInput,
  PagoInput,
  ResultadoRendicion,
  TipoEntregaOrden,
} from '../../../types/domain';

interface RendicionPagoProps {
  total: number;
  clienteId: number;
  items: ItemCarrito[];
  onExito: (resultado: ResultadoRendicion) => void;
}

/** Unidad en que se tipeó la línea (y en la que se expresa el retiro inmediato del split). */
function unidadLabel(item: ItemCarrito): string {
  return (item.unidad_ingreso ?? 'U') === 'KG' ? 'kg' : 'u';
}

/**
 * Modal de Rendición de Pago Mixto (F12). Distribuye el total entre varias
 * cuentas y, al confirmar (F5 fiscal / F6 interno), factura contra el
 * backend. Un remanente sin cubrir es válido: queda como saldo deudor.
 *
 * Además maneja la VENTA MIXTA (F7): un editor por renglón donde el cajero
 * indica cuánto se lleva el cliente ahora y cuánto queda pendiente. Si algo
 * queda pendiente, el saldo se cumple por mostrador (retiro) o por envío a
 * domicilio; en ese último caso la dirección y la fecha pactada son
 * OBLIGATORIAS y bloquean el cobro hasta estar completas. Cuando no queda
 * nada pendiente (todo retiro inmediato) el flujo es idéntico a la venta
 * simple de siempre.
 */
export function RendicionPago({ total, clienteId, items, onExito }: RendicionPagoProps): JSX.Element {
  const [cuentas, setCuentas] = useState<CuentaEmpresa[]>([]);
  const [pagos, setPagos] = useState<PagoInput[]>([]);
  const [filtro, setFiltro] = useState('');
  const [indiceResaltado, setIndiceResaltado] = useState(0);
  const [cuentaSeleccionada, setCuentaSeleccionada] = useState<CuentaEmpresa | null>(null);
  const [monto, setMonto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mostrarAutorizacion, setMostrarAutorizacion] = useState(false);
  const [pin, setPin] = useState('');
  /** Recordado entre el primer intento y el reintento con PIN de supervisor, para no perder la elección F5/F6. */
  const [esFiscalElegido, setEsFiscalElegido] = useState(true);

  // --- Venta mixta (split por renglón, F7) ---
  const [mostrarSplit, setMostrarSplit] = useState(false);
  /** Cuánto de cada renglón se lleva el cliente ahora (misma unidad que `cantidad`). Default: todo (venta simple). */
  const [retiros, setRetiros] = useState<number[]>(() => items.map((it) => it.cantidad));
  const [tipoEntrega, setTipoEntrega] = useState<TipoEntregaOrden>('RETIRO_CLIENTE');
  const [direccionEnvio, setDireccionEnvio] = useState('');
  const [fechaPactada, setFechaPactada] = useState('');
  /** Se enciende al intentar cobrar con datos de envío faltantes, para pintarlos en rojo. */
  const [marcarFaltantes, setMarcarFaltantes] = useState(false);

  const inputFiltroRef = useRef<HTMLInputElement>(null);
  const inputMontoRef = useRef<HTMLInputElement>(null);
  const primerRetiroRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listarCuentasEmpresa().then((res) => setCuentas(res.cuentas));
  }, []);

  useEffect(() => {
    if (!cuentaSeleccionada) inputFiltroRef.current?.focus();
    else inputMontoRef.current?.focus();
  }, [cuentaSeleccionada]);

  // Al abrir el split, llevar el foco al primer "se lleva ahora" para editar sin mouse.
  useEffect(() => {
    if (mostrarSplit) primerRetiroRef.current?.focus();
  }, [mostrarSplit]);

  const pagado = useMemo(() => pagos.reduce((acc, p) => acc + p.monto, 0), [pagos]);
  const restante = Math.max(0, Number((total - pagado).toFixed(2)));

  const hayPendiente = useMemo(
    () => items.some((it, i) => (retiros[i] ?? it.cantidad) < it.cantidad),
    [items, retiros],
  );
  const envioIncompleto = tipoEntrega === 'ENVIO_DOMICILIO' && (!direccionEnvio.trim() || !fechaPactada);

  const cuentasFiltradas = useMemo(() => {
    const termino = filtro.trim().toLowerCase();
    if (!termino) return cuentas;
    return cuentas.filter((c) => c.nombre_cuenta.toLowerCase().includes(termino));
  }, [cuentas, filtro]);

  function setRetiro(indice: number, item: ItemCarrito, valorCrudo: string): void {
    const parsed = Number(valorCrudo);
    const acotado = Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, item.cantidad)) : 0;
    setRetiros((prev) => prev.map((r, j) => (j === indice ? acotado : r)));
  }

  function agregarPago(): void {
    if (!cuentaSeleccionada || Number(monto) <= 0) return;
    const montoNumerico = Math.min(Number(monto), restante);
    setPagos((prev) => [...prev, { id_cuenta: cuentaSeleccionada.id_cuenta, monto: montoNumerico }]);
    setCuentaSeleccionada(null);
    setMonto('');
    setFiltro('');
    setIndiceResaltado(0);
  }

  function quitarUltimoPago(): void {
    setPagos((prev) => prev.slice(0, -1));
  }

  function onKeyDownLista(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndiceResaltado((i) => Math.min(i + 1, cuentasFiltradas.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndiceResaltado((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const cuenta = cuentasFiltradas[indiceResaltado];
      if (cuenta) setCuentaSeleccionada(cuenta);
    } else if (event.key === 'Backspace' && filtro === '') {
      quitarUltimoPago();
    }
  }

  function onKeyDownMonto(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      agregarPago();
    }
  }

  async function enviarFacturacion(esFiscal: boolean, pinSupervisor?: string): Promise<void> {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    try {
      let resultado: ResultadoRendicion;

      if (hayPendiente) {
        const esEnvio = tipoEntrega === 'ENVIO_DOMICILIO';
        const itemsMixta: ItemVentaMixtaInput[] = items.map((it, i) => ({
          id_producto: it.id_producto,
          cantidad: it.cantidad,
          unidad_ingreso: it.unidad_ingreso,
          precio_unitario: it.precio_unitario,
          cantidad_retiro_inmediato: retiros[i] ?? 0,
        }));
        const res = await procesarVentaMixta(
          {
            cliente_id: clienteId,
            items: itemsMixta,
            pagos,
            es_fiscal: esFiscal,
            tipo_entrega: tipoEntrega,
            direccion_envio: esEnvio ? direccionEnvio.trim() : undefined,
            fecha_pactada_envio: esEnvio ? fechaPactada : undefined,
          },
          pinSupervisor,
        );
        resultado = {
          documento: res.documento,
          saldo_pendiente: Number((total - pagado).toFixed(2)),
          pagos: pagos.map((p) => ({
            concepto: cuentas.find((c) => c.id_cuenta === p.id_cuenta)?.nombre_cuenta ?? 'Pago',
            monto: p.monto,
          })),
          orden_entrega: res.orden_entrega,
        };
      } else {
        const res = await facturarVenta(
          {
            cliente_id: clienteId,
            items: items.map((it) => ({
              id_producto: it.id_producto,
              cantidad: it.cantidad,
              unidad_ingreso: it.unidad_ingreso,
              precio_unitario: it.precio_unitario,
            })),
            total_neto: total,
            pagos,
            es_fiscal: esFiscal,
          },
          pinSupervisor,
        );
        resultado = {
          documento: res.documento,
          saldo_pendiente: res.saldo_pendiente,
          pagos: res.movimientos
            .filter((m) => Number(m.haber) > 0)
            .map((m) => ({ concepto: m.concepto ?? 'Pago', monto: Number(m.haber) })),
          autorizacion: res.autorizacion,
        };
      }

      onExito(resultado);
    } catch (err) {
      // El override por PIN de supervisor sólo existe en la venta simple
      // (`/facturar`); `/facturar-mixta` no tiene ese middleware, así que en
      // la mixta el límite excedido se muestra como error sin ofrecer PIN.
      if (err instanceof ApiError && err.code === 'LIMITE_CREDITO_EXCEDIDO' && !hayPendiente) {
        setMostrarAutorizacion(true);
        setError(err.message);
      } else if (err instanceof ApiError && err.code === 'PIN_SUPERVISOR_INVALIDO') {
        setError(err.message);
        setPin('');
      } else {
        setError(err instanceof ApiError ? err.message : 'Error inesperado al facturar la venta.');
      }
    } finally {
      setEnviando(false);
    }
  }

  function confirmarFacturacion(esFiscal: boolean): void {
    if (pagos.length === 0) return;
    // Bloqueo estricto: un envío a domicilio sin dirección/fecha no puede cobrarse.
    if (hayPendiente && tipoEntrega === 'ENVIO_DOMICILIO' && envioIncompleto) {
      setMarcarFaltantes(true);
      setMostrarSplit(true);
      setError('Para un envío a domicilio, la dirección y la fecha pactada son obligatorias.');
      return;
    }
    setEsFiscalElegido(esFiscal);
    void enviarFacturacion(esFiscal);
  }

  function onPinCompleto(pinCompleto: string): void {
    void enviarFacturacion(esFiscalElegido, pinCompleto);
  }

  function cancelarAutorizacion(): void {
    setMostrarAutorizacion(false);
    setError(null);
    setPin('');
  }

  // F5 (Factura Fiscal) / F6 (Comprobante Interno) confirman; F7 abre/cierra
  // el editor de split (venta mixta). Se desactivan mientras se elige el
  // monto de una cuenta o se espera el PIN, para no confirmar sin querer.
  useGlobalHotkeys(
    {
      F5: () => confirmarFacturacion(true),
      F6: () => confirmarFacturacion(false),
      F7: () => setMostrarSplit((v) => !v),
    },
    !cuentaSeleccionada && !mostrarAutorizacion,
  );

  return (
    <Modal titulo="Rendición de Pago Mixto (F5 fiscal · F6 interno · F7 entrega)" ancho="lg">
      <div className="mb-4 grid grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-neutral-500">Total venta</div>
          <div className="font-mono text-lg font-semibold text-neutral-900">${total.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-neutral-500">Pagado</div>
          <div className="font-mono text-lg font-semibold text-exito">${pagado.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-neutral-500">Restante (saldo deudor)</div>
          <div className={`font-mono text-lg font-semibold ${restante > 0 ? 'text-peligro' : 'text-neutral-900'}`}>
            ${restante.toFixed(2)}
          </div>
        </div>
      </div>

      {!mostrarAutorizacion && (
        <div className="mb-4 rounded-lg border border-neutral-200">
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setMostrarSplit((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
          >
            <span className="font-medium text-neutral-700">
              Entrega de la mercadería{' '}
              <span className="text-xs text-neutral-400">(F7)</span>
            </span>
            <span className={`text-xs font-medium ${hayPendiente ? 'text-acento' : 'text-neutral-400'}`}>
              {hayPendiente
                ? tipoEntrega === 'ENVIO_DOMICILIO'
                  ? 'Con saldo pendiente · Envío a domicilio'
                  : 'Con saldo pendiente · Retiro en mostrador'
                : 'Todo se lo lleva ahora'}
            </span>
          </button>

          {mostrarSplit && (
            <div className="border-t border-neutral-200 px-3 py-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
                    <th className="pb-1">Producto</th>
                    <th className="pb-1 text-right">Total</th>
                    <th className="pb-1 text-right">Se lleva ahora</th>
                    <th className="pb-1 text-right">Pendiente</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const ahora = retiros[i] ?? it.cantidad;
                    const pendiente = Number((it.cantidad - ahora).toFixed(3));
                    return (
                      <tr key={i} className="border-t border-neutral-100">
                        <td className="py-1.5">
                          {it.descripcion}
                          <span className="ml-2 font-mono text-xs text-neutral-400">{it.sku}</span>
                        </td>
                        <td className="py-1.5 text-right font-mono text-neutral-600">
                          {it.cantidad} {unidadLabel(it)}
                        </td>
                        <td className="py-1.5 text-right">
                          <input
                            ref={i === 0 ? primerRetiroRef : undefined}
                            type="number"
                            min="0"
                            max={it.cantidad}
                            step="any"
                            value={ahora}
                            onChange={(e) => setRetiro(i, it, e.target.value)}
                            className="w-20 rounded border border-neutral-300 px-2 py-1 text-right font-mono focus:border-acento"
                          />
                        </td>
                        <td className={`py-1.5 text-right font-mono ${pendiente > 0 ? 'text-acento' : 'text-neutral-400'}`}>
                          {pendiente} {unidadLabel(it)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {hayPendiente && (
                <div className="mt-3 rounded border border-acento/30 bg-acento/5 p-3">
                  <div className="mb-2 text-xs font-medium text-neutral-600">
                    El saldo pendiente queda como Orden de Entrega. ¿Cómo se cumple?
                  </div>
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
                          setTipoEntrega(valor);
                          setMarcarFaltantes(false);
                        }}
                        className={`flex-1 rounded border px-3 py-1.5 text-sm font-medium ${
                          tipoEntrega === valor
                            ? 'border-acento bg-acento/10 text-acento'
                            : 'border-neutral-300 text-neutral-600 hover:border-neutral-400'
                        }`}
                      >
                        {etiqueta}
                      </button>
                    ))}
                  </div>

                  {tipoEntrega === 'ENVIO_DOMICILIO' && (
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="block text-sm">
                        <span className="mb-1 block text-neutral-600">
                          Dirección de envío <span className="text-peligro">*</span>
                        </span>
                        <input
                          value={direccionEnvio}
                          onChange={(e) => {
                            setDireccionEnvio(e.target.value);
                            setError(null);
                          }}
                          placeholder="Calle, número, localidad…"
                          className={`w-full rounded border px-3 py-2 focus:border-acento ${
                            marcarFaltantes && !direccionEnvio.trim() ? 'border-peligro bg-red-50' : 'border-neutral-300'
                          }`}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1 block text-neutral-600">
                          Fecha pactada <span className="text-peligro">*</span>
                        </span>
                        <input
                          type="date"
                          value={fechaPactada}
                          onChange={(e) => {
                            setFechaPactada(e.target.value);
                            setError(null);
                          }}
                          className={`w-full rounded border px-3 py-2 focus:border-acento ${
                            marcarFaltantes && !fechaPactada ? 'border-peligro bg-red-50' : 'border-neutral-300'
                          }`}
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ul className="mb-4 divide-y divide-neutral-100 text-sm">
        {pagos.map((p, i) => (
          <li key={i} className="flex justify-between py-1.5">
            <span className="text-neutral-600">{cuentas.find((c) => c.id_cuenta === p.id_cuenta)?.nombre_cuenta}</span>
            <span className="font-mono text-neutral-900">${p.monto.toFixed(2)}</span>
          </li>
        ))}
      </ul>

      {!mostrarAutorizacion && restante > 0 && !cuentaSeleccionada && (
        <input
          ref={inputFiltroRef}
          value={filtro}
          onChange={(e) => {
            setFiltro(e.target.value);
            setIndiceResaltado(0);
          }}
          onKeyDown={onKeyDownLista}
          placeholder="Medio de pago… (↑/↓ navega, Enter selecciona, Backspace borra el último)"
          className="mb-2 w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-acento"
        />
      )}

      {!mostrarAutorizacion && !cuentaSeleccionada && restante > 0 && (
        <ul className="max-h-40 overflow-y-auto text-sm">
          {cuentasFiltradas.map((c, i) => (
            <li
              key={c.id_cuenta}
              className={`rounded px-3 py-1.5 ${i === indiceResaltado ? 'bg-acento/10 text-acento' : 'text-neutral-700'}`}
            >
              {c.nombre_cuenta}
            </li>
          ))}
        </ul>
      )}

      {!mostrarAutorizacion && cuentaSeleccionada && (
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-600">Monto en {cuentaSeleccionada.nombre_cuenta}</span>
          <input
            ref={inputMontoRef}
            type="number"
            min="0"
            step="0.01"
            max={restante}
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            onKeyDown={onKeyDownMonto}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>
      )}

      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}

      {mostrarAutorizacion && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-4">
          <p className="mb-3 text-sm font-medium text-amber-900">
            Autorizar con PIN de Supervisor para facturar de todos modos
            {' '}
            ({esFiscalElegido ? 'Factura Fiscal' : 'Comprobante Interno'})
          </p>
          <PinInput value={pin} onChange={setPin} onComplete={onPinCompleto} disabled={enviando} autoFocus />
          <button
            type="button"
            tabIndex={-1}
            onClick={cancelarAutorizacion}
            className="mt-3 text-xs text-neutral-500 hover:text-neutral-700"
          >
            ‹ volver a la rendición de pago
          </button>
        </div>
      )}

      <p className="mt-4 text-xs text-neutral-400">
        {enviando
          ? 'Facturando…'
          : mostrarAutorizacion
            ? 'Esc cancela'
            : hayPendiente
              ? 'F5 Factura Fiscal · F6 Comprobante Interno · F7 entrega · Esc cancela — el saldo queda en Orden de Entrega'
              : 'F5 Factura Fiscal (AFIP) · F6 Comprobante Interno (Remito X) · F7 entrega · Esc cancela'}
      </p>
    </Modal>
  );
}
