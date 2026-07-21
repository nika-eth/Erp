import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';
import { actualizarCotEnvio } from '../../../api/logistica';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import type { EnvioAsignado } from '../../../types/domain';
import { Modal } from '../../common/Modal';
import { ImprimirCot } from './ImprimirCot';

interface EditarCotProps {
  envio: EnvioAsignado;
  patente: string;
  chofer: string;
  fecha: string;
  onGuardado: (envio: EnvioAsignado) => void;
  onCancelar: () => void;
}

/**
 * Modal rápido para cargar/corregir el Código de Operación de Traslado
 * (COT, exigido por ARBA) de un envío ya asignado (clic sobre el envío en
 * `GrillaRuteoCamiones`). F12 guarda; una vez guardado, F6 imprime el
 * remito con el COT al pie (`ImprimirCot.tsx`).
 */
export function EditarCot({ envio, patente, chofer, fecha, onGuardado, onCancelar }: EditarCotProps): JSX.Element {
  const [nroCot, setNroCot] = useState(envio.nro_cot ?? '');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [envioActual, setEnvioActual] = useState(envio);
  const [imprimir, setImprimir] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (!imprimir) return;
    const t = setTimeout(() => window.print(), 150);
    return () => clearTimeout(t);
  }, [imprimir]);

  async function confirmar(): Promise<void> {
    if (enviando || !nroCot.trim()) {
      if (!nroCot.trim()) setError('El número de COT es requerido.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const { envio: actualizado } = await actualizarCotEnvio(envio.id_envio, { nro_cot: nroCot.trim() });
      setEnvioActual(actualizado);
      onGuardado(actualizado);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el COT.');
    } finally {
      setEnviando(false);
    }
  }

  useGlobalHotkeys({
    F12: () => void confirmar(),
    F6: () => {
      if (envioActual.nro_cot) setImprimir(true);
    },
    Escape: onCancelar,
  });

  return (
    <Modal titulo={`COT — Remito ${envio.nro_remito ?? envio.id_documento} (F12 guarda)`} ancho="md">
      <p className="mb-1 text-sm font-medium text-neutral-900">{envio.cliente}</p>
      <p className="mb-4 text-xs text-neutral-400">
        {envio.zona} · Camión {patente} · {fecha}
      </p>

      <label className="block text-sm">
        <span className="mb-1 block text-neutral-600">Número de COT</span>
        <input
          ref={inputRef}
          value={nroCot}
          onChange={(e) => setNroCot(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void confirmar()}
          className="w-full rounded border border-neutral-300 px-3 py-2 font-mono focus:border-acento"
        />
      </label>

      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}

      <p className="mt-4 text-xs text-neutral-400">
        {enviando ? 'Guardando…' : envioActual.nro_cot ? 'F12 guarda · F6 imprime Remito + COT · Esc cierra' : 'F12 guarda · Esc cierra'}
      </p>

      {imprimir && <ImprimirCot envio={envioActual} patente={patente} chofer={chofer} fecha={fecha} />}
    </Modal>
  );
}
