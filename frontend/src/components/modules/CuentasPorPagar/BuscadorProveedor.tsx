import { useEffect, useRef, useState } from 'react';
import { buscarProveedores } from '../../../api/proveedores';
import type { Proveedor } from '../../../types/domain';

interface BuscadorProveedorProps {
  onSeleccionar: (proveedor: Proveedor) => void;
  autoFocus?: boolean;
}

/**
 * Buscador de proveedores reutilizable (carga de facturas/NC, y a futuro la
 * Ficha de Emisión de OP). Mismo patrón debounced + navegación por flechas
 * que `GestionProductos.tsx`, pero como lista de selección en vez de tabla.
 */
export function BuscadorProveedor({ onSeleccionar, autoFocus = true }: BuscadorProveedorProps): JSX.Element {
  const [termino, setTermino] = useState('');
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [indice, setIndice] = useState(0);
  const [buscando, setBuscando] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (termino.trim().length < 2) {
      setProveedores([]);
      return;
    }
    setBuscando(true);
    const t = setTimeout(() => {
      buscarProveedores(termino.trim())
        .then((res) => {
          setProveedores(res.proveedores);
          setIndice(0);
        })
        .finally(() => setBuscando(false));
    }, 250);
    return () => clearTimeout(t);
  }, [termino]);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndice((i) => Math.min(i + 1, proveedores.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndice((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const proveedor = proveedores[indice];
      if (proveedor) onSeleccionar(proveedor);
    }
  }

  return (
    <div>
      <label className="block text-sm">
        <span className="mb-1 block text-neutral-600">Proveedor (nombre o CUIT/DNI)</span>
        <input
          ref={inputRef}
          value={termino}
          onChange={(e) => setTermino(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="2+ caracteres, ↑/↓ navega, Enter selecciona"
          className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
        />
      </label>

      {termino.trim().length >= 2 && (
        <ul className="mt-1 max-h-48 divide-y divide-neutral-100 overflow-y-auto rounded border border-neutral-200">
          {proveedores.map((p, i) => (
            <li
              key={p.id_proveedor}
              onClick={() => onSeleccionar(p)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === indice ? 'bg-acento/10' : ''}`}
            >
              <span className="font-medium text-neutral-900">{p.nombre}</span>
              <span className="ml-2 text-xs text-neutral-400">
                {p.tipo_documento} {p.numero_documento}
              </span>
            </li>
          ))}
          {!buscando && proveedores.length === 0 && (
            <li className="px-3 py-2 text-sm text-neutral-400">Sin resultados.</li>
          )}
        </ul>
      )}
    </div>
  );
}
