import { useEffect, useMemo, useRef, useState } from 'react';
import { listarMateriales } from '../../../api/catalogos';
import { Modal } from '../../common/Modal';
import type { ItemInput, MaterialCatalogo } from '../../../types/domain';

interface CatalogoMaterialesProps {
  onSeleccionar: (item: ItemInput) => void;
}

/**
 * Catálogo flotante de hierros (F1). Selección en dos pasos, sin mouse:
 *   1. Se filtra la lista escribiendo y se navega con las flechas; Enter
 *      elige el material resaltado.
 *   2. Se cargan cantidad y precio; los kilos se calculan automáticamente
 *      a partir del peso teórico del ítem. Enter confirma y agrega el ítem.
 */
export function CatalogoMateriales({ onSeleccionar }: CatalogoMaterialesProps): JSX.Element {
  const [materiales, setMateriales] = useState<MaterialCatalogo[]>([]);
  const [filtro, setFiltro] = useState('');
  const [indiceResaltado, setIndiceResaltado] = useState(0);
  const [seleccionado, setSeleccionado] = useState<MaterialCatalogo | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [precioUnitario, setPrecioUnitario] = useState('');

  const inputFiltroRef = useRef<HTMLInputElement>(null);
  const inputCantidadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listarMateriales().then((res) => setMateriales(res.materiales));
  }, []);

  useEffect(() => {
    if (!seleccionado) inputFiltroRef.current?.focus();
    else inputCantidadRef.current?.focus();
  }, [seleccionado]);

  const materialesFiltrados = useMemo(() => {
    const termino = filtro.trim().toLowerCase();
    if (!termino) return materiales;
    return materiales.filter(
      (m) => m.descripcion.toLowerCase().includes(termino) || m.id_material.toLowerCase().includes(termino),
    );
  }, [materiales, filtro]);

  const kilos = seleccionado ? Number(cantidad || 0) * seleccionado.peso_teorico_kg : 0;

  function onKeyDownLista(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndiceResaltado((i) => Math.min(i + 1, materialesFiltrados.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndiceResaltado((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const material = materialesFiltrados[indiceResaltado];
      if (material) setSeleccionado(material);
    }
  }

  function onKeyDownCantidad(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!seleccionado || Number(cantidad) <= 0 || Number(precioUnitario) <= 0) return;
    onSeleccionar({
      id_material: seleccionado.id_material,
      descripcion: seleccionado.descripcion,
      cantidad: Number(cantidad),
      peso_teorico_kg: seleccionado.peso_teorico_kg,
      precio_unitario: Number(precioUnitario),
    });
  }

  return (
    <Modal titulo="Catálogo de hierros (F1)" ancho="lg">
      {!seleccionado ? (
        <>
          <input
            ref={inputFiltroRef}
            value={filtro}
            onChange={(e) => {
              setFiltro(e.target.value);
              setIndiceResaltado(0);
            }}
            onKeyDown={onKeyDownLista}
            placeholder="Buscar material… (↑/↓ navega, Enter selecciona)"
            className="mb-3 w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-acento"
          />
          {/* select-text explícito: permite copiar la descripción de un material con el mouse. */}
          <ul className="max-h-72 select-text overflow-y-auto text-sm">
            {materialesFiltrados.map((m, i) => (
              <li
                key={m.id_material}
                className={`flex justify-between rounded px-3 py-2 ${
                  i === indiceResaltado ? 'bg-acento/10 text-acento' : 'text-neutral-700'
                }`}
              >
                <span>{m.descripcion}</span>
                <span className="text-neutral-400">{m.peso_teorico_kg} kg/{m.unidad}</span>
              </li>
            ))}
            {materialesFiltrados.length === 0 && (
              <li className="px-3 py-2 text-neutral-400">Sin resultados.</li>
            )}
          </ul>
        </>
      ) : (
        <div className="text-sm">
          <p className="mb-4 select-text font-medium text-neutral-900">{seleccionado.descripcion}</p>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-neutral-600">Cantidad ({seleccionado.unidad})</span>
              <input
                ref={inputCantidadRef}
                type="number"
                min="0"
                step="0.01"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                onKeyDown={onKeyDownCantidad}
                className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-neutral-600">Precio unitario / kg</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={precioUnitario}
                onChange={(e) => setPrecioUnitario(e.target.value)}
                onKeyDown={onKeyDownCantidad}
                className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
              />
            </label>
          </div>
          <p className="text-neutral-500">
            Kilos calculados: <span className="font-mono font-medium text-neutral-900">{kilos.toFixed(2)} kg</span>
          </p>
          <p className="mt-3 text-xs text-neutral-400">Enter para agregar el ítem · Esc para cerrar</p>
        </div>
      )}
    </Modal>
  );
}
