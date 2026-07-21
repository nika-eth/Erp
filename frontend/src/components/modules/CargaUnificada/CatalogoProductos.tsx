import { useEffect, useRef, useState } from 'react';
import { buscarProductos } from '../../../api/productos';
import { resolverCantidadUnidades } from '../../../utils/cantidad';
import { Modal } from '../../common/Modal';
import type { ItemCarrito, Producto, UnidadIngresoCantidad } from '../../../types/domain';

interface CatalogoProductosProps {
  onSeleccionar: (item: ItemCarrito) => void;
}

const ETIQUETA_UNIDAD: Record<Producto['unidad_venta'], string> = {
  KILO: 'por kilo',
  UNIDAD: 'por unidad',
};

/**
 * Catálogo flotante de productos (F1). Busca contra `productos` real (no un
 * catálogo hardcodeado): tipea 2+ caracteres de SKU o descripción, navega
 * con flechas, Enter elige. Los materiales se venden en unidades físicas
 * enteras (sin fraccionamiento): el selector [U | KG] permite cargar la
 * cantidad como conteo de unidades o en kilos — en modo KG se calcula y
 * valida en vivo que equivalga a una cantidad entera de unidades (misma
 * tolerancia que el backend, ver `resolverCantidadUnidades`), bloqueando el
 * alta si no da exacto.
 */
export function CatalogoProductos({ onSeleccionar }: CatalogoProductosProps): JSX.Element {
  const [termino, setTermino] = useState('');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [indiceResaltado, setIndiceResaltado] = useState(0);
  const [seleccionado, setSeleccionado] = useState<Producto | null>(null);
  const [unidadIngreso, setUnidadIngreso] = useState<UnidadIngresoCantidad>('U');
  const [cantidad, setCantidad] = useState('');
  const [precioUnitario, setPrecioUnitario] = useState('');

  const inputFiltroRef = useRef<HTMLInputElement>(null);
  const inputCantidadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!seleccionado) inputFiltroRef.current?.focus();
    else inputCantidadRef.current?.focus();
  }, [seleccionado]);

  // Al elegir un producto, el selector U/KG arranca en el modo que sugiere
  // su unidad_venta (precio por kilo -> default KG), pero se puede cambiar.
  useEffect(() => {
    if (seleccionado) setUnidadIngreso(seleccionado.unidad_venta === 'KILO' ? 'KG' : 'U');
  }, [seleccionado]);

  // Búsqueda debounced: espera una pausa de tipeo antes de golpear la API.
  useEffect(() => {
    if (termino.trim().length < 2) {
      setProductos([]);
      return;
    }
    setBuscando(true);
    const t = setTimeout(() => {
      buscarProductos(termino.trim())
        .then((res) => {
          setProductos(res.productos);
          setIndiceResaltado(0);
        })
        .finally(() => setBuscando(false));
    }, 250);
    return () => clearTimeout(t);
  }, [termino]);

  const pesoTeorico = seleccionado ? Number(seleccionado.peso_teorico_kg) : 0;
  const resolucion = seleccionado ? resolverCantidadUnidades(Number(cantidad || 0), unidadIngreso, pesoTeorico) : null;

  function onKeyDownLista(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndiceResaltado((i) => Math.min(i + 1, productos.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndiceResaltado((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const producto = productos[indiceResaltado];
      if (producto) setSeleccionado(producto);
    }
  }

  function onKeyDownCantidad(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!seleccionado || !resolucion?.valido || Number(precioUnitario) <= 0) return;
    onSeleccionar({
      id_producto: seleccionado.id_producto,
      sku: seleccionado.sku,
      descripcion: seleccionado.descripcion,
      unidad_venta: seleccionado.unidad_venta,
      peso_teorico_kg: pesoTeorico,
      cantidad: Number(cantidad),
      unidad_ingreso: unidadIngreso,
      cantidadUnidades: resolucion.cantidadUnidades,
      precio_unitario: Number(precioUnitario),
    });
  }

  return (
    <Modal titulo="Catálogo de productos (F1)" ancho="lg">
      {!seleccionado ? (
        <>
          <input
            ref={inputFiltroRef}
            value={termino}
            onChange={(e) => setTermino(e.target.value)}
            onKeyDown={onKeyDownLista}
            placeholder="Buscar por SKU o descripción… (↑/↓ navega, Enter selecciona)"
            className="mb-3 w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-acento"
          />
          <ul className="max-h-72 select-text overflow-y-auto text-sm">
            {productos.map((p, i) => (
              <li
                key={p.id_producto}
                className={`flex justify-between rounded px-3 py-2 ${
                  i === indiceResaltado ? 'bg-acento/10 text-acento' : 'text-neutral-700'
                }`}
              >
                <span>
                  <span className="mr-2 font-mono text-xs text-neutral-400">{p.sku}</span>
                  {p.descripcion}
                </span>
                <span className="text-neutral-400">{ETIQUETA_UNIDAD[p.unidad_venta]}</span>
              </li>
            ))}
            {!buscando && termino.trim().length >= 2 && productos.length === 0 && (
              <li className="px-3 py-2 text-neutral-400">Sin resultados.</li>
            )}
            {termino.trim().length < 2 && (
              <li className="px-3 py-2 text-neutral-400">Escribí al menos 2 caracteres para buscar.</li>
            )}
          </ul>
        </>
      ) : (
        <div className="text-sm">
          <p className="mb-1 select-text font-medium text-neutral-900">{seleccionado.descripcion}</p>
          <p className="mb-4 text-xs text-neutral-400">
            SKU {seleccionado.sku} · venta {ETIQUETA_UNIDAD[seleccionado.unidad_venta]}
          </p>

          <div className="mb-3">
            <span className="mb-1 block text-neutral-600">Cargar cantidad en</span>
            <div className="flex gap-2">
              {(['U', 'KG'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  tabIndex={-1}
                  disabled={u === 'KG' && pesoTeorico <= 0}
                  title={u === 'KG' && pesoTeorico <= 0 ? 'Este producto no tiene peso teórico cargado (Gestión de Productos, F7).' : undefined}
                  onClick={() => setUnidadIngreso(u)}
                  className={`flex-1 rounded border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40 ${
                    unidadIngreso === u ? 'border-acento bg-acento/10 text-acento' : 'border-neutral-300 text-neutral-600'
                  }`}
                >
                  {u === 'U' ? 'Unidades (U)' : 'Kilos (KG)'}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-neutral-600">Cantidad {unidadIngreso === 'KG' ? '(kg)' : '(unidades)'}</span>
              <input
                ref={inputCantidadRef}
                type="number"
                min="0"
                step="0.01"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                onKeyDown={onKeyDownCantidad}
                className={`w-full rounded border px-3 py-2 focus:border-acento ${
                  resolucion && !resolucion.valido && cantidad !== '' ? 'border-peligro' : 'border-neutral-300'
                }`}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-neutral-600">
                Precio {seleccionado.unidad_venta === 'KILO' ? 'por kg' : 'por unidad'}
              </span>
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

          {cantidad !== '' && resolucion && (
            <p className={resolucion.valido ? 'text-neutral-500' : 'font-medium text-peligro'}>
              {resolucion.valido
                ? unidadIngreso === 'U'
                  ? `Equivale a: ${resolucion.equivalenteKg?.toFixed(2)} kg`
                  : `Equivale a: ${resolucion.cantidadUnidades} unidad(es)`
                : resolucion.mensaje}
            </p>
          )}

          <p className="mt-3 text-xs text-neutral-400">Enter para agregar el ítem · Esc para cerrar</p>
        </div>
      )}
    </Modal>
  );
}
