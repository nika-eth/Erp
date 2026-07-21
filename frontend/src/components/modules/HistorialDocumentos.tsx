import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { buscarDocumentos } from '../../api/documentos';
import { useGlobalHotkeys } from '../../hooks/useGlobalHotkeys';
import type { Documento } from '../../types/domain';
import { FichaDespacho } from './FichaDespacho';

const ETIQUETA_TIPO: Record<Documento['tipo_documento'], string> = {
  FACTURA_A: 'Factura A',
  FACTURA_B: 'Factura B',
  PRESUPUESTO: 'Presupuesto',
};

/** Buscador indexado de Facturas y Presupuestos (F3). */
export function HistorialDocumentos({ onSalir }: { onSalir: () => void }): JSX.Element {
  const [termino, setTermino] = useState('');
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [indiceSeleccionado, setIndiceSeleccionado] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fichaDespachoAbierta, setFichaDespachoAbierta] = useState(false);

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
      setIndiceSeleccionado(0);
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

  const documentoSeleccionado = documentos[indiceSeleccionado] ?? null;

  function onKeyDownBusqueda(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      void buscar();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndiceSeleccionado((i) => Math.min(i + 1, documentos.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndiceSeleccionado((i) => Math.max(i - 1, 0));
    }
  }

  useGlobalHotkeys(
    {
      F8: () => documentoSeleccionado && setFichaDespachoAbierta(true),
      Escape: onSalir,
    },
    !fichaDespachoAbierta,
  );

  return (
    <div className="flex h-full flex-col gap-4 bg-white p-6">
      <label className="block w-96 text-sm">
        <span className="mb-1 block text-neutral-600">Cliente, CUIT/DNI o Nº de remito</span>
        <input
          ref={inputRef}
          value={termino}
          onChange={(e) => setTermino(e.target.value)}
          onKeyDown={onKeyDownBusqueda}
          placeholder="Enter para buscar, ↑/↓ selecciona"
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
            {documentos.map((d, i) => (
              <tr
                key={d.id_documento}
                className={`border-b border-neutral-100 ${i === indiceSeleccionado ? 'bg-acento/10' : ''}`}
              >
                <td className="px-4 py-2 font-mono">{d.nro_remito ?? '—'}</td>
                <td className="px-4 py-2">
                  {ETIQUETA_TIPO[d.tipo_documento]}
                  {d.tipo_documento !== 'PRESUPUESTO' && (
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium ${
                        d.es_fiscal
                          ? 'bg-green-50 text-exito'
                          : d.estado_facturacion_interna === 'FACTURADA'
                            ? 'bg-neutral-100 text-neutral-500'
                            : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {d.es_fiscal ? 'Fiscal' : d.estado_facturacion_interna === 'FACTURADA' ? 'Interno (facturado)' : 'Interno'}
                    </span>
                  )}
                </td>
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

      <div className="text-xs text-neutral-400">
        {documentoSeleccionado && documentoSeleccionado.tipo_documento !== 'PRESUPUESTO'
          ? 'F8 ficha de despacho · Esc para volver'
          : 'Esc para volver'}
      </div>

      {fichaDespachoAbierta && documentoSeleccionado && (
        <FichaDespacho
          documentoInicial={documentoSeleccionado}
          onCerrar={() => setFichaDespachoAbierta(false)}
        />
      )}
    </div>
  );
}
