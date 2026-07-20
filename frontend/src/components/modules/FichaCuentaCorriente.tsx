import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { buscarClientes } from '../../api/clientes';
import { obtenerFichaCuentaCorriente } from '../../api/cuentaCorriente';
import { useGlobalHotkeys } from '../../hooks/useGlobalHotkeys';
import type { Cliente, FichaCuentaCorriente as FichaCuentaCorrienteType } from '../../types/domain';

/** Ficha Contable de Cuenta Corriente (F9): DEBE | HABER | SALDO TOTAL. */
export function FichaCuentaCorriente({ onSalir }: { onSalir: () => void }): JSX.Element {
  const [termino, setTermino] = useState('');
  const [candidatos, setCandidatos] = useState<Cliente[]>([]);
  const [indiceResaltado, setIndiceResaltado] = useState(0);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [ficha, setFicha] = useState<FichaCuentaCorrienteType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
    try {
      setFicha(await obtenerFichaCuentaCorriente(c.id_cliente));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la ficha de cuenta corriente.');
    }
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

  useGlobalHotkeys({
    Escape: () => {
      if (cliente) {
        setCliente(null);
        setFicha(null);
        inputRef.current?.focus();
      } else {
        onSalir();
      }
    },
  });

  return (
    <div className="flex h-full flex-col gap-4 bg-white p-6">
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
              {c.nombre} — {c.cuit_dni}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}

      {cliente && ficha && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-neutral-900">{cliente.nombre}</div>
              <div className="text-xs text-neutral-500">{cliente.cuit_dni}</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Saldo total</div>
              <div
                className={`font-mono text-xl font-semibold ${
                  Number(ficha.saldo_total) > 0 ? 'text-peligro' : 'text-neutral-900'
                }`}
              >
                ${Number(ficha.saldo_total).toFixed(2)}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2">Concepto</th>
                  <th className="px-4 py-2 text-right">Debe</th>
                  <th className="px-4 py-2 text-right">Haber</th>
                  <th className="px-4 py-2 text-right">Saldo Total</th>
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
                    <td className="px-4 py-2 text-right font-mono">${Number(m.saldo).toFixed(2)}</td>
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
        {cliente ? 'Esc para buscar otro cliente' : 'Esc para volver'}
      </div>
    </div>
  );
}
