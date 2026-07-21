import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';
import { actualizarProveedor } from '../../../api/proveedores';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import { Modal } from '../../common/Modal';
import type { CondicionIvaProveedor, Proveedor } from '../../../types/domain';

interface EditarProveedorProps {
  proveedor: Proveedor;
  onGuardado: (proveedor: Proveedor) => void;
  onCancelar: () => void;
}

const ETIQUETA_CONDICION_IVA: Record<CondicionIvaProveedor, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
  MONOTRIBUTO: 'Monotributo',
  EXENTO: 'Exento',
};

const CONDICIONES_IVA: CondicionIvaProveedor[] = ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'];

/** Edición de proveedor (Gestión de Proveedores, F1). `tipo_documento`/`numero_documento` no se editan: es la identificación fiscal estable. */
export function EditarProveedor({ proveedor, onGuardado, onCancelar }: EditarProveedorProps): JSX.Element {
  const [nombre, setNombre] = useState(proveedor.nombre);
  const [condicionIva, setCondicionIva] = useState<CondicionIvaProveedor>(proveedor.condicion_iva);
  const [direccion, setDireccion] = useState(proveedor.direccion ?? '');
  const [telefono, setTelefono] = useState(proveedor.telefono ?? '');
  const [email, setEmail] = useState(proveedor.email ?? '');
  const [activo, setActivo] = useState(proveedor.activo);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputNombreRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputNombreRef.current?.focus();
    inputNombreRef.current?.select();
  }, []);

  async function confirmar(): Promise<void> {
    if (enviando) return;
    if (!nombre.trim()) {
      setError('El nombre no puede quedar vacío.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const { proveedor: actualizado } = await actualizarProveedor(proveedor.id_proveedor, {
        nombre: nombre.trim(),
        condicion_iva: condicionIva,
        direccion: direccion.trim() || null,
        telefono: telefono.trim() || null,
        email: email.trim() || null,
        activo,
      });
      onGuardado(actualizado);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el proveedor.');
    } finally {
      setEnviando(false);
    }
  }

  useGlobalHotkeys({
    F12: () => void confirmar(),
    Escape: onCancelar,
  });

  return (
    <Modal titulo={`Editar Proveedor — ${proveedor.tipo_documento} ${proveedor.numero_documento} (F12 confirma)`} ancho="lg">
      <div className="grid grid-cols-2 gap-4 text-sm">
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
          <span className="mb-1 block text-neutral-600">Teléfono</span>
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="col-span-2 block">
          <span className="mb-1 block text-neutral-600">Dirección</span>
          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="col-span-2 block">
          <span className="mb-1 block text-neutral-600">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="col-span-2 flex items-center gap-2">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          <span className="text-neutral-600">Activo (disponible para cargar facturas y emitir OP)</span>
        </label>
      </div>

      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}

      <p className="mt-4 text-xs text-neutral-400">{enviando ? 'Guardando…' : 'F12 confirma · Esc cancela'}</p>
    </Modal>
  );
}
