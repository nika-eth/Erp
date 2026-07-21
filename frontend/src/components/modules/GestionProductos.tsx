import { useEffect, useRef, useState } from 'react';
import { buscarProductosParaGestion } from '../../api/productos';
import { useGlobalHotkeys } from '../../hooks/useGlobalHotkeys';
import type { Producto } from '../../types/domain';
import { EditarProducto } from './EditarProducto';

/** Gestión de Productos (F7): buscar y corregir datos de productos existentes (ej. peso_teorico_kg). */
export function GestionProductos({ onSalir }: { onSalir: () => void }): JSX.Element {
  const [termino, setTermino] = useState('');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [indiceSeleccionado, setIndiceSeleccionado] = useState(0);
  const [editarAbierto, setEditarAbierto] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Búsqueda debounced, mismo patrón que el catálogo de Carga Unificada (F1).
  useEffect(() => {
    if (termino.trim().length < 2) {
      setProductos([]);
      return;
    }
    setBuscando(true);
    const t = setTimeout(() => {
      buscarProductosParaGestion(termino.trim())
        .then((res) => {
          setProductos(res.productos);
          setIndiceSeleccionado(0);
        })
        .finally(() => setBuscando(false));
    }, 250);
    return () => clearTimeout(t);
  }, [termino]);

  useEffect(() => {
    if (!mensaje) return;
    const t = setTimeout(() => setMensaje(null), 5000);
    return () => clearTimeout(t);
  }, [mensaje]);

  const productoSeleccionado = productos[indiceSeleccionado] ?? null;

  function onKeyDownBusqueda(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndiceSeleccionado((i) => Math.min(i + 1, productos.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndiceSeleccionado((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (productoSeleccionado) setEditarAbierto(true);
    }
  }

  function onGuardado(actualizado: Producto): void {
    setProductos((lista) => lista.map((p) => (p.id_producto === actualizado.id_producto ? actualizado : p)));
    setEditarAbierto(false);
    setMensaje(`${actualizado.sku} actualizado.`);
  }

  useGlobalHotkeys(
    {
      F1: () => productoSeleccionado && setEditarAbierto(true),
      Escape: onSalir,
    },
    !editarAbierto,
  );

  return (
    <div className="flex h-full flex-col gap-4 bg-white p-6">
      <label className="block w-96 text-sm">
        <span className="mb-1 block text-neutral-600">Buscar producto por SKU o descripción</span>
        <input
          ref={inputRef}
          value={termino}
          onChange={(e) => setTermino(e.target.value)}
          onKeyDown={onKeyDownBusqueda}
          placeholder="2+ caracteres, ↑/↓ navega, F1 o Enter edita"
          className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
        />
      </label>

      {mensaje && <p className="rounded bg-green-50 px-3 py-2 text-sm text-exito">{mensaje}</p>}

      <div className="flex-1 overflow-y-auto rounded-lg border border-neutral-200">
        {/* select-text explícito: permite copiar sku/descripción con el mouse. */}
        <table className="w-full select-text text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Descripción</th>
              <th className="px-4 py-2">Unidad</th>
              <th className="px-4 py-2 text-right">Peso teórico (kg)</th>
              <th className="px-4 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {productos.map((p, i) => (
              <tr
                key={p.id_producto}
                className={`border-b border-neutral-100 ${i === indiceSeleccionado ? 'bg-acento/10' : ''}`}
              >
                <td className="px-4 py-2 font-mono">{p.sku}</td>
                <td className="px-4 py-2">{p.descripcion}</td>
                <td className="px-4 py-2">{p.unidad_venta}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {p.unidad_venta === 'KILO' && Number(p.peso_teorico_kg) === 0 ? (
                    <span className="text-peligro">0.000</span>
                  ) : (
                    Number(p.peso_teorico_kg).toFixed(3)
                  )}
                </td>
                <td className="px-4 py-2">
                  {p.activo ? (
                    <span className="text-exito">Activo</span>
                  ) : (
                    <span className="text-neutral-400">Inactivo</span>
                  )}
                </td>
              </tr>
            ))}
            {!buscando && termino.trim().length >= 2 && productos.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                  Sin resultados.
                </td>
              </tr>
            )}
            {termino.trim().length < 2 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                  Escribí al menos 2 caracteres para buscar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-neutral-400">
        {productoSeleccionado ? 'F1 editar producto · Esc para volver' : 'Esc para volver'}
      </div>

      {editarAbierto && productoSeleccionado && (
        <EditarProducto
          producto={productoSeleccionado}
          onGuardado={onGuardado}
          onCancelar={() => setEditarAbierto(false)}
        />
      )}
    </div>
  );
}
