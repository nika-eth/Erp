import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';
import { crearProveedor } from '../../../api/proveedores';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import { Modal } from '../../common/Modal';
import type { CondicionIvaProveedor, Proveedor, TipoDocumentoCliente } from '../../../types/domain';

interface CrearProveedorProps {
  onCreado: (proveedor: Proveedor) => void;
  onCancelar: () => void;
}

const ETIQUETA_CONDICION_IVA: Record<CondicionIvaProveedor, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
  MONOTRIBUTO: 'Monotributo',
  EXENTO: 'Exento',
};

const CONDICIONES_IVA: CondicionIvaProveedor[] = ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'];

/** Sugerencia automática por longitud; el operador puede corregirla a mano. */
function detectarTipoDocumento(numeroDocumento: string): TipoDocumentoCliente | null {
  const digitos = numeroDocumento.replace(/\D/g, '');
  if (digitos.length === 11) return 'CUIT';
  if (digitos.length === 7 || digitos.length === 8) return 'DNI';
  return null;
}

/** Alta de proveedor (Gestión de Proveedores, F2). Un proveedor nunca puede ser Consumidor Final (no existe esa condición IVA acá). */
export function CrearProveedor({ onCreado, onCancelar }: CrearProveedorProps): JSX.Element {
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumentoCliente>('CUIT');
  const [condicionIva, setCondicionIva] = useState<CondicionIvaProveedor>('RESPONSABLE_INSCRIPTO');
  const [nombre, setNombre] = useState('');
  const [direccion, setDireccion] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputNombreRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputNombreRef.current?.focus();
  }, []);

  function onCambiarNumeroDocumento(valor: string): void {
    setNumeroDocumento(valor);
    const detectado = detectarTipoDocumento(valor);
    if (detectado) setTipoDocumento(detectado);
  }

  async function confirmar(): Promise<void> {
    if (enviando) return;
    if (!nombre.trim()) {
      setError('El nombre / razón social es requerido.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const { proveedor } = await crearProveedor({
        nombre: nombre.trim(),
        tipo_documento: tipoDocumento,
        numero_documento: numeroDocumento,
        condicion_iva: condicionIva,
        direccion: direccion.trim() || undefined,
        telefono: telefono.trim() || undefined,
        email: email.trim() || undefined,
      });
      onCreado(proveedor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el proveedor.');
    } finally {
      setEnviando(false);
    }
  }

  useGlobalHotkeys({
    F12: () => void confirmar(),
    Escape: onCancelar,
  });

  return (
    <Modal titulo="Nuevo Proveedor (F12 confirma)" ancho="lg">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <label className="block">
          <span className="mb-1 block text-neutral-600">CUIT / DNI</span>
          <input
            value={numeroDocumento}
            onChange={(e) => onCambiarNumeroDocumento(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">Tipo de documento</span>
          <div className="flex gap-2">
            {(['DNI', 'CUIT'] as const).map((t) => (
              <button
                key={t}
                type="button"
                tabIndex={-1}
                onClick={() => setTipoDocumento(t)}
                className={`flex-1 rounded border px-3 py-2 ${
                  tipoDocumento === t ? 'border-acento bg-acento/10 text-acento' : 'border-neutral-300 text-neutral-600'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </label>

        <label className="col-span-2 block">
          <span className="mb-1 block text-neutral-600">Nombre / Razón social</span>
          <input
            ref={inputNombreRef}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">Condición frente al IVA</span>
          <select
            value={condicionIva}
            onChange={(e) => setCondicionIva(e.target.value as CondicionIvaProveedor)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          >
            {CONDICIONES_IVA.map((c) => (
              <option key={c} value={c}>
                {ETIQUETA_CONDICION_IVA[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">Teléfono (opcional)</span>
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="col-span-2 block">
          <span className="mb-1 block text-neutral-600">Dirección (opcional)</span>
          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="col-span-2 block">
          <span className="mb-1 block text-neutral-600">Email (opcional)</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>
      </div>

      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}

      <p className="mt-4 text-xs text-neutral-400">{enviando ? 'Creando…' : 'F12 confirma · Esc cancela'}</p>
    </Modal>
  );
}
