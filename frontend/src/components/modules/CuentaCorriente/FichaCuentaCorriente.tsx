import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';
import { buscarClientes } from '../../../api/clientes';
import { obtenerFichaCuentaCorriente } from '../../../api/cuentaCorriente';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import type { Cliente, EmitirReciboResult, FichaCuentaCorriente as FichaCuentaCorrienteType } from '../../../types/domain';
import { ModalCobranza } from './ModalCobranza';

/**
 * Ficha Contable de Cuenta Corriente (F9). Se monta como overlay de
 * pantalla completa por encima de lo que esté activo (ver `App.tsx` +
 * `HotkeySuspensionBoundary`), no como un módulo más que reemplaza la
 * pantalla — así F9 funciona desde cualquier punto de la app sin perder el
 * trabajo en curso en otra pantalla.
 */
export function FichaCuentaCorriente({ onSalir }: { onSalir: () => void }): JSX.Element {
  const [termino, setTermino] = useState('');
  const [candidatos, setCandidatos] = useState<Cliente[]>([]);
  const [indiceResaltado, setIndiceResaltado] = useState(0);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [ficha, setFicha] = useState<FichaCuentaCorrienteType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cobranzaAbierta, setCobranzaAbierta] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!mensaje) return;
    const t = setTimeout(() => setMensaje(null), 5000);
    return () => clearTimeout(t);
  }, [mensaje]);

  async function recargarFicha(idCliente: number): Promise<void> {
    try {
      setFicha(await obtenerFichaCuentaCorriente(idCliente));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la ficha de cuenta corriente.');
    }
  }

  async function buscarCliente(): Promise<void> {
    setError(null);
    try {
      const { clientes } = await buscarClientes(termino.trim());
      if (clientes.length === 1) {
        await seleccionarCliente(clientes[0]);
      } else {
        setCandidatos(clientes);
        setIndiceResaltado(0);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo buscar el cliente.');
    }
  }

  async function seleccionarCliente(c: Cliente): Promise<void> {
    setCliente(c);
    setCandidatos([]);
    await recargarFicha(c.id_cliente);
  }

  function onKeyDownBusqueda(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (candidatos.length === 0) {
      if (event.key === 'Enter') {
        event.preventDefault();
        void buscarCliente();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndiceResaltado((i) => Math.min(i + 1, candidatos.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndiceResaltado((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void seleccionarCliente(candidatos[indiceResaltado]);
    }
  }

  function onCobranzaEmitida(resultado: EmitirReciboResult): void {
    setCobranzaAbierta(false);
    setMensaje(
      `Recibo #${resultado.recibo.nro_recibo} emitido por $${Number(resultado.recibo.monto_total).toFixed(2)}.`,
    );
    if (cliente) void recargarFicha(cliente.id_cliente);
  }

  useGlobalHotkeys({
    F2: () => {
      if (cliente && ficha && !cobranzaAbierta) setCobranzaAbierta(true);
    },
    Escape: () => {
      if (cobranzaAbierta) setCobranzaAbierta(false);
      else if (cliente) {
        setCliente(null);
        setFicha(null);
        inputRef.current?.focus();
      } else {
        onSalir();
      }
    },
  });

  const saldoTotal = ficha ? Number(ficha.saldo_total) : 0;

  return (
    <div className="fixed inset-0 z-30 flex h-full flex-col gap-4 bg-white p-6">
      {!cliente && (
        <label className="block w-96 text-sm">
          <span className="mb-1 block text-neutral-600">Cliente (nombre o CUIT/DNI)</span>
          <input
            ref={inputRef}
            value={termino}
            onChange={(e) => setTermino(e.target.value)}
            onKeyDown={onKeyDownBusqueda}
            placeholder="Enter para buscar"
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>
      )}

      {candidatos.length > 1 && (
        <ul className="w-96 text-sm">
          {candidatos.map((c, i) => (
            <li
              key={c.id_cliente}
              className={`rounded px-3 py-1.5 ${i === indiceResaltado ? 'bg-acento/10 text-acento' : 'text-neutral-700'}`}
            >
              {c.nombre} — {c.numero_documento}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}
      {mensaje && <p className="rounded bg-green-50 px-3 py-2 text-sm text-exito">{mensaje}</p>}

      {cliente && ficha && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-neutral-900">{ficha.cliente.nombre}</div>
              <div className="text-xs text-neutral-500">
                {ficha.cliente.numero_documento} · Límite de crédito: ${Number(ficha.cliente.limite_credito).toFixed(2)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Saldo acumulado</div>
              <div className={`font-mono text-2xl font-bold ${saldoTotal > 0 ? 'text-peligro' : 'text-exito'}`}>
                ${saldoTotal.toFixed(2)}
              </div>
              <div className="text-xs text-neutral-400">
                {saldoTotal > 0 ? 'Deudor' : saldoTotal < 0 ? 'Saldo a favor' : 'Al día'}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2">Concepto / Comprobante</th>
                  <th className="px-4 py-2 text-right">Debe</th>
                  <th className="px-4 py-2 text-right">Haber</th>
                  <th className="px-4 py-2 text-right">Saldo Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {ficha.movimientos.map((m) => (
                  <tr key={m.id_movimiento} className="border-b border-neutral-100">
                    <td className="px-4 py-2">{new Date(m.fecha).toLocaleString('es-AR')}</td>
                    <td className="px-4 py-2">{m.concepto ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {Number(m.debe) > 0 ? `$${Number(m.debe).toFixed(2)}` : ''}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {Number(m.haber) > 0 ? `$${Number(m.haber).toFixed(2)}` : ''}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono font-medium ${
                        Number(m.saldo) > 0 ? 'text-peligro' : 'text-exito'
                      }`}
                    >
                      ${Number(m.saldo).toFixed(2)}
                    </td>
                  </tr>
                ))}
                {ficha.movimientos.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                      Sin movimientos.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="text-xs text-neutral-400">
        {cliente ? 'F2 emitir recibo de cobranza · Esc para buscar otro cliente' : 'Esc para volver'}
      </div>

      {cobranzaAbierta && cliente && <ModalCobranza clienteId={cliente.id_cliente} onEmitido={onCobranzaEmitida} />}
    </div>
  );
}
