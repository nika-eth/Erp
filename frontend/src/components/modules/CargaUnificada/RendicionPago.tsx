import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';
import { listarCuentasEmpresa } from '../../../api/catalogos';
import { facturarVenta } from '../../../api/ventas';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import { Modal } from '../../common/Modal';
import type { CuentaEmpresa, FacturarVentaResult, ItemInput, PagoInput } from '../../../types/domain';

interface RendicionPagoProps {
  total: number;
  clienteId: number;
  items: ItemInput[];
  onExito: (resultado: FacturarVentaResult) => void;
}

/**
 * Modal de Rendición de Pago Mixto (F12). Permite distribuir el total entre
 * varias cuentas (Efectivo, Banco Galicia, etc.) y, al confirmar, dispara la
 * facturación real contra `POST /api/ventas/facturar`. Un remanente sin
 * cubrir es válido: queda como saldo deudor en la cuenta corriente.
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

  const inputFiltroRef = useRef<HTMLInputElement>(null);
  const inputMontoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listarCuentasEmpresa().then((res) => setCuentas(res.cuentas));
  }, []);

  useEffect(() => {
    if (!cuentaSeleccionada) inputFiltroRef.current?.focus();
    else inputMontoRef.current?.focus();
  }, [cuentaSeleccionada]);

  const pagado = useMemo(() => pagos.reduce((acc, p) => acc + p.monto, 0), [pagos]);
  const restante = Math.max(0, Number((total - pagado).toFixed(2)));

  const cuentasFiltradas = useMemo(() => {
    const termino = filtro.trim().toLowerCase();
    if (!termino) return cuentas;
    return cuentas.filter((c) => c.nombre_cuenta.toLowerCase().includes(termino));
  }, [cuentas, filtro]);

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

  async function confirmarFacturacion(): Promise<void> {
    if (pagos.length === 0 || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const resultado = await facturarVenta({ cliente_id: clienteId, items, total_neto: total, pagos });
      onExito(resultado);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error inesperado al facturar la venta.');
    } finally {
      setEnviando(false);
    }
  }

  // F12 dentro de este modal confirma la facturación (distinto del F12 que
  // abre el modal desde Carga Unificada).
  useGlobalHotkeys({ F12: () => void confirmarFacturacion() }, !cuentaSeleccionada);

  return (
    <Modal titulo="Rendición de Pago Mixto (F12 confirma)" ancho="lg">
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

      <ul className="mb-4 divide-y divide-neutral-100 text-sm">
        {pagos.map((p, i) => (
          <li key={i} className="flex justify-between py-1.5">
            <span className="text-neutral-600">{cuentas.find((c) => c.id_cuenta === p.id_cuenta)?.nombre_cuenta}</span>
            <span className="font-mono text-neutral-900">${p.monto.toFixed(2)}</span>
          </li>
        ))}
      </ul>

      {restante > 0 && !cuentaSeleccionada && (
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

      {!cuentaSeleccionada && restante > 0 && (
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

      {cuentaSeleccionada && (
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

      <p className="mt-4 text-xs text-neutral-400">
        {enviando ? 'Facturando…' : 'F12 confirma la facturación · Esc cancela'}
      </p>
    </Modal>
  );
}
