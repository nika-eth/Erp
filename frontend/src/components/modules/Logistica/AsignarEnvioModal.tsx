import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';
import { asignarEnvio, listarCamiones, listarDocumentosPendientes } from '../../../api/logistica';
import { Modal } from '../../common/Modal';
import type { Camion, DocumentoPendiente, EnvioAsignado } from '../../../types/domain';

interface AsignarEnvioModalProps {
  fecha: string;
  onAsignado: (envio: EnvioAsignado) => void;
}

/**
 * Modal de asignación de envío (F1 dentro de Control de Ruteo). Selección
 * en dos pasos, sin mouse: primero el remito pendiente, después el camión.
 * Si el backend rechaza por falta de cupo (409), el error se muestra en el
 * modal sin cerrarlo para que se pueda elegir otro camión.
 */
export function AsignarEnvioModal({ fecha, onAsignado }: AsignarEnvioModalProps): JSX.Element {
  const [documentos, setDocumentos] = useState<DocumentoPendiente[]>([]);
  const [camiones, setCamiones] = useState<Camion[]>([]);
  const [documentoSeleccionado, setDocumentoSeleccionado] = useState<DocumentoPendiente | null>(null);

  const [filtroDocumento, setFiltroDocumento] = useState('');
  const [indiceDocumento, setIndiceDocumento] = useState(0);
  const [filtroCamion, setFiltroCamion] = useState('');
  const [indiceCamion, setIndiceCamion] = useState(0);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputDocumentoRef = useRef<HTMLInputElement>(null);
  const inputCamionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listarDocumentosPendientes().then((res) => setDocumentos(res.documentos));
    listarCamiones().then((res) => setCamiones(res.camiones));
  }, []);

  useEffect(() => {
    if (!documentoSeleccionado) inputDocumentoRef.current?.focus();
    else inputCamionRef.current?.focus();
  }, [documentoSeleccionado]);

  const documentosFiltrados = useMemo(() => {
    const termino = filtroDocumento.trim().toLowerCase();
    if (!termino) return documentos;
    return documentos.filter(
      (d) => d.cliente.toLowerCase().includes(termino) || String(d.nro_remito ?? '').includes(termino),
    );
  }, [documentos, filtroDocumento]);

  const camionesFiltrados = useMemo(() => {
    const termino = filtroCamion.trim().toLowerCase();
    if (!termino) return camiones;
    return camiones.filter(
      (c) => c.chofer.toLowerCase().includes(termino) || c.patente.toLowerCase().includes(termino),
    );
  }, [camiones, filtroCamion]);

  function onKeyDownDocumentos(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndiceDocumento((i) => Math.min(i + 1, documentosFiltrados.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndiceDocumento((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const documento = documentosFiltrados[indiceDocumento];
      if (documento) {
        setDocumentoSeleccionado(documento);
        setError(null);
      }
    }
  }

  async function confirmarAsignacion(camion: Camion): Promise<void> {
    if (!documentoSeleccionado || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const { envio } = await asignarEnvio({
        id_camion: camion.id_camion,
        id_documento: documentoSeleccionado.id_documento,
        fecha_despacho: fecha,
      });
      onAsignado(envio);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo asignar el envío.');
    } finally {
      setEnviando(false);
    }
  }

  function onKeyDownCamiones(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndiceCamion((i) => Math.min(i + 1, camionesFiltrados.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndiceCamion((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const camion = camionesFiltrados[indiceCamion];
      if (camion) void confirmarAsignacion(camion);
    } else if (event.key === 'Backspace' && filtroCamion === '') {
      setDocumentoSeleccionado(null);
      setError(null);
    }
  }

  return (
    <Modal titulo={`Asignar envío — despacho ${fecha}`} ancho="lg">
      {!documentoSeleccionado ? (
        <>
          <input
            ref={inputDocumentoRef}
            value={filtroDocumento}
            onChange={(e) => {
              setFiltroDocumento(e.target.value);
              setIndiceDocumento(0);
            }}
            onKeyDown={onKeyDownDocumentos}
            placeholder="Remito o cliente… (↑/↓ navega, Enter selecciona)"
            className="mb-3 w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-acento"
          />
          <ul className="max-h-72 overflow-y-auto text-sm">
            {documentosFiltrados.map((d, i) => (
              <li
                key={d.id_documento}
                className={`flex justify-between rounded px-3 py-2 ${
                  i === indiceDocumento ? 'bg-acento/10 text-acento' : 'text-neutral-700'
                }`}
              >
                <span>
                  Remito #{d.nro_remito} — {d.cliente}
                </span>
                <span className="text-neutral-400">
                  {d.zona ?? 'sin zona'} · {d.kilosTotales} kg
                </span>
              </li>
            ))}
            {documentosFiltrados.length === 0 && (
              <li className="px-3 py-2 text-neutral-400">No hay remitos pendientes de asignar.</li>
            )}
          </ul>
        </>
      ) : (
        <div className="text-sm">
          <p className="mb-1 text-neutral-500">
            Remito #{documentoSeleccionado.nro_remito} — {documentoSeleccionado.cliente} ·{' '}
            {documentoSeleccionado.zona ?? 'sin zona'} · {documentoSeleccionado.kilosTotales} kg
          </p>
          <input
            ref={inputCamionRef}
            value={filtroCamion}
            onChange={(e) => {
              setFiltroCamion(e.target.value);
              setIndiceCamion(0);
            }}
            onKeyDown={onKeyDownCamiones}
            placeholder="Camión… (↑/↓ navega, Enter asigna, Backspace vuelve)"
            className="mb-3 mt-3 w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
          <ul className="max-h-56 overflow-y-auto">
            {camionesFiltrados.map((c, i) => (
              <li
                key={c.id_camion}
                className={`flex justify-between rounded px-3 py-2 ${
                  i === indiceCamion ? 'bg-acento/10 text-acento' : 'text-neutral-700'
                }`}
              >
                <span>
                  {c.chofer} <span className="font-mono text-neutral-400">{c.patente}</span>
                </span>
                <span className="text-neutral-400">
                  {c.capacidad_casilleros} casilleros · {c.capacidad_kilos_max} kg
                </span>
              </li>
            ))}
            {camionesFiltrados.length === 0 && <li className="px-3 py-2 text-neutral-400">Sin camiones.</li>}
          </ul>
        </div>
      )}

      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}
      <p className="mt-4 text-xs text-neutral-400">{enviando ? 'Asignando…' : 'Esc para cerrar'}</p>
    </Modal>
  );
}
