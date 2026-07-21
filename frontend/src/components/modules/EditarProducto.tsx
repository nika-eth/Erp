import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { actualizarProducto } from '../../api/productos';
import { useGlobalHotkeys } from '../../hooks/useGlobalHotkeys';
import type { Producto, UnidadVentaProducto } from '../../types/domain';
import { Modal } from '../common/Modal';

interface EditarProductoProps {
  producto: Producto;
  onGuardado: (producto: Producto) => void;
  onCancelar: () => void;
}

/**
 * Edición de producto (Gestión de Productos, F7). Pensada sobre todo para
 * corregir `peso_teorico_kg` en productos KILO importados sin peso (el
 * Excel de stock inicial no traía esa columna). `sku` no se edita: es la
 * referencia estable ya usada en ventas históricas.
 */
export function EditarProducto({ producto, onGuardado, onCancelar }: EditarProductoProps): JSX.Element {
  const [descripcion, setDescripcion] = useState(producto.descripcion);
  const [unidadVenta, setUnidadVenta] = useState<UnidadVentaProducto>(producto.unidad_venta);
  const [pesoTeoricoKg, setPesoTeoricoKg] = useState(producto.peso_teorico_kg);
  const [activo, setActivo] = useState(producto.activo);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputDescripcionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputDescripcionRef.current?.focus();
    inputDescripcionRef.current?.select();
  }, []);

  async function confirmar(): Promise<void> {
    if (enviando) return;
    if (!descripcion.trim()) {
      setError('La descripción no puede quedar vacía.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const { producto: actualizado } = await actualizarProducto(producto.id_producto, {
        descripcion: descripcion.trim(),
        unidad_venta: unidadVenta,
        peso_teorico_kg: Number(pesoTeoricoKg),
        activo,
      });
      onGuardado(actualizado);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el producto.');
    } finally {
      setEnviando(false);
    }
  }

  useGlobalHotkeys({
    F12: () => void confirmar(),
    Escape: onCancelar,
  });

  return (
    <Modal titulo={`Editar Producto — ${producto.sku} (F12 confirma)`} ancho="md">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <label className="col-span-2 block">
          <span className="mb-1 block text-neutral-600">Descripción</span>
          <input
            ref={inputDescripcionRef}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">Unidad de venta</span>
          <div className="flex gap-2">
            {(['KILO', 'UNIDAD'] as const).map((u) => (
              <button
                key={u}
                type="button"
                tabIndex={-1}
                onClick={() => setUnidadVenta(u)}
                className={`flex-1 rounded border px-3 py-2 ${
                  unidadVenta === u ? 'border-acento bg-acento/10 text-acento' : 'border-neutral-300 text-neutral-600'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">Peso teórico (kg)</span>
          <input
            type="number"
            min="0"
            step="0.001"
            value={pesoTeoricoKg}
            onChange={(e) => setPesoTeoricoKg(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 font-mono focus:border-acento"
          />
        </label>

        <label className="col-span-2 flex items-center gap-2">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          <span className="text-neutral-600">Activo (vendible en Carga Unificada)</span>
        </label>
      </div>

      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}

      <p className="mt-4 text-xs text-neutral-400">{enviando ? 'Guardando…' : 'F12 confirma · Esc cancela'}</p>
    </Modal>
  );
}
