import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';
import { listarCuentasEmpresa } from '../../../api/catalogos';
import { emitirRecibo } from '../../../api/recibos';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import { Modal } from '../../common/Modal';
import type { CuentaEmpresa, EmitirReciboResult, PagoReciboInput } from '../../../types/domain';

interface ModalCobranzaProps {
  clienteId: number;
  onEmitido: (resultado: EmitirReciboResult) => void;
}

/**
 * Modal "Emitir Recibo de Cobranza" (F2 dentro de la Ficha Contable).
 * Selección de medio de pago en dos pasos, igual que la Rendición de Pago
 * Mixto de Carga Unificada: cuenta -> monto (+ nº de comprobante opcional
 * para cheque/transferencia). F12 confirma el recibo completo — se usa F12
 * en vez de Enter porque Enter ya está ocupado avanzando entre los campos
 * de cada línea de pago, y F12 es la tecla que el resto de la app usa para
 * confirmar una operación de dinero (mismo atajo que la Rendición de Pago).
 */
export function ModalCobranza({ clienteId, onEmitido }: ModalCobranzaProps): JSX.Element {
  const [cuentas, setCuentas] = useState<CuentaEmpresa[]>([]);
  const [pagos, setPagos] = useState<PagoReciboInput[]>([]);
  const [filtro, setFiltro] = useState('');
  const [indiceResaltado, setIndiceResaltado] = useState(0);
  const [cuentaSeleccionada, setCuentaSeleccionada] = useState<CuentaEmpresa | null>(null);
  const [monto, setMonto] = useState('');
  const [nroComprobante, setNroComprobante] = useState('');
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

  const total = useMemo(() => pagos.reduce((acc, p) => acc + p.monto, 0), [pagos]);

  const cuentasFiltradas = useMemo(() => {
    const término = filtro.trim().toLowerCase();
    if (!término) return cuentas;
    return cuentas.filter((c) => c.nombre_cuenta.toLowerCase().includes(término));
  }, [cuentas, filtro]);

  function agregarPago(): void {
    if (!cuentaSeleccionada || Number(monto) <= 0) return;
    setPagos((prev) => [
      ...prev,
      { id_cuenta: cuentaSeleccionada.id_cuenta, monto: Number(monto), nro_comprobante: nroComprobante.trim() || undefined },
    ]);
    setCuentaSeleccionada(null);
    setMonto('');
    setNroComprobante('');
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

  function onKeyDownMontoOComprobante(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      agregarPago();
    }
  }

  async function confirmarRecibo(): Promise<void> {
    if (pagos.length === 0 || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const resultado = await emitirRecibo({ cliente_id: clienteId, pagos });
      onEmitido(resultado);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo emitir el recibo.');
    } finally {
      setEnviando(false);
    }
  }

  useGlobalHotkeys({ F12: () => void confirmarRecibo() }, !cuentaSeleccionada);

  return (
    <Modal titulo="Emitir Recibo de Cobranza (F12 confirma)" ancho="lg">
      <div className="mb-4">
        <div className="text-neutral-500">Total a cobrar</div>
        <div className="font-mono text-2xl font-bold text-exito">${total.toFixed(2)}</div>
      </div>

      <ul className="mb-4 divide-y divide-neutral-100 text-sm">
        {pagos.map((p, i) => (
          <li key={i} className="flex justify-between py-1.5">
            <span className="text-neutral-600">
              {cuentas.find((c) => c.id_cuenta === p.id_cuenta)?.nombre_cuenta}
              {p.nro_comprobante && <span className="ml-2 text-xs text-neutral-400">#{p.nro_comprobante}</span>}
            </span>
            <span className="font-mono text-neutral-900">${p.monto.toFixed(2)}</span>
          </li>
        ))}
      </ul>

      {!cuentaSeleccionada && (
        <>
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
        </>
      )}

      {cuentaSeleccionada && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-neutral-600">Monto en {cuentaSeleccionada.nombre_cuenta}</span>
            <input
              ref={inputMontoRef}
              type="number"
              min="0"
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              onKeyDown={onKeyDownMontoOComprobante}
              className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-neutral-600">Nº comprobante (opcional)</span>
            <input
              value={nroComprobante}
              onChange={(e) => setNroComprobante(e.target.value)}
              onKeyDown={onKeyDownMontoOComprobante}
              placeholder="cheque / transferencia"
              className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
            />
          </label>
        </div>
      )}

      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}

      <p className="mt-4 text-xs text-neutral-400">
        {enviando ? 'Emitiendo…' : 'F12 confirma el recibo · Esc cancela'}
      </p>
    </Modal>
  );
}
