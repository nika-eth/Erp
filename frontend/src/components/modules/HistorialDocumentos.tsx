import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { buscarDocumentos } from '../../api/documentos';
import { useGlobalHotkeys } from '../../hooks/useGlobalHotkeys';
import type { Documento } from '../../types/domain';

const ETIQUETA_TIPO: Record<Documento['tipo_documento'], string> = {
  FACTURA_A: 'Factura A',
  FACTURA_B: 'Factura B',
  PRESUPUESTO: 'Presupuesto',
};

/** Buscador indexado de Facturas y Presupuestos (F3). */
export function HistorialDocumentos({ onSalir }: { onSalir: () => void }): JSX.Element {
  const [termino, setTermino] = useState('');
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function buscar(): Promise<void> {
    setBuscando(true);
    setError(null);
    try {
      const esNumerico = /^\d+$/.test(termino.trim());
      const { documentos: resultado } = await buscarDocumentos(
        esNumerico && termino.trim() ? { nro_remito: Number(termino.trim()) } : { cliente: termino.trim() },
      );
      setDocumentos(resultado);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo buscar el historial.');
    } finally {
      setBuscando(false);
    }
  }

  useEffect(() => {
    void buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useGlobalHotkeys({ Escape: onSalir });

  return (
    <div className="flex h-full flex-col gap-4 bg-white p-6">
      <label className="block w-96 text-sm">
        <span className="mb-1 block text-neutral-600">Cliente, CUIT/DNI o Nº de remito</span>
        <input
          ref={inputRef}
          value={termino}
          onChange={(e) => setTermino(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void buscar()}
          placeholder="Enter para buscar"
          className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
        />
      </label>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}

      <div className="flex-1 overflow-y-auto rounded-lg border border-neutral-200">
        {/* select-text explícito: permite copiar remito/cliente/total con el mouse. */}
        <table className="w-full select-text text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-2">Remito</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Cliente</th>
              <th className="px-4 py-2">Sucursal</th>
              <th className="px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {documentos.map((d) => (
              <tr key={d.id_documento} className="border-b border-neutral-100">
                <td className="px-4 py-2 font-mono">{d.nro_remito ?? '—'}</td>
                <td className="px-4 py-2">{ETIQUETA_TIPO[d.tipo_documento]}</td>
                <td className="px-4 py-2">{new Date(d.fecha).toLocaleString('es-AR')}</td>
                <td className="px-4 py-2">{d.cliente_nombre}</td>
                <td className="px-4 py-2">{d.sucursal_nombre}</td>
                <td className="px-4 py-2 text-right font-mono">${Number(d.total_neto).toFixed(2)}</td>
              </tr>
            ))}
            {!buscando && documentos.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                  Sin resultados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-neutral-400">Esc para volver</div>
    </div>
  );
}
