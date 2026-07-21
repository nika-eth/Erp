import { useEffect, useRef, useState } from 'react';
import { buscarProveedoresParaGestion } from '../../../api/proveedores';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import type { Proveedor } from '../../../types/domain';
import { CrearProveedor } from './CrearProveedor';
import { EditarProveedor } from './EditarProveedor';

/** Gestión de Proveedores: buscar, dar de alta y corregir datos de proveedores existentes. */
export function GestionProveedores({ onSalir }: { onSalir: () => void }): JSX.Element {
  const [termino, setTermino] = useState('');
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [indiceSeleccionado, setIndiceSeleccionado] = useState(0);
  const [editarAbierto, setEditarAbierto] = useState(false);
  const [crearAbierto, setCrearAbierto] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (termino.trim().length < 2) {
      setProveedores([]);
      return;
    }
    setBuscando(true);
    const t = setTimeout(() => {
      buscarProveedoresParaGestion(termino.trim())
        .then((res) => {
          setProveedores(res.proveedores);
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

  const proveedorSeleccionado = proveedores[indiceSeleccionado] ?? null;
  const modalAbierto = editarAbierto || crearAbierto;

  function onKeyDownBusqueda(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndiceSeleccionado((i) => Math.min(i + 1, proveedores.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndiceSeleccionado((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (proveedorSeleccionado) setEditarAbierto(true);
    }
  }

  function onGuardado(actualizado: Proveedor): void {
    setProveedores((lista) => lista.map((p) => (p.id_proveedor === actualizado.id_proveedor ? actualizado : p)));
    setEditarAbierto(false);
    setMensaje(`${actualizado.nombre} actualizado.`);
  }

  function onCreado(nuevo: Proveedor): void {
    setCrearAbierto(false);
    setMensaje(`${nuevo.nombre} creado.`);
    setTermino(nuevo.numero_documento);
  }

  useGlobalHotkeys(
    {
      F1: () => proveedorSeleccionado && setEditarAbierto(true),
      F2: () => setCrearAbierto(true),
      Escape: onSalir,
    },
    !modalAbierto,
  );

  return (
    <div className="flex h-full flex-col gap-4 bg-white p-6">
      <label className="block w-96 text-sm">
        <span className="mb-1 block text-neutral-600">Buscar proveedor por nombre o CUIT/DNI</span>
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
        <table className="w-full select-text text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Documento</th>
              <th className="px-4 py-2">Condición IVA</th>
              <th className="px-4 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {proveedores.map((p, i) => (
              <tr
                key={p.id_proveedor}
                className={`border-b border-neutral-100 ${i === indiceSeleccionado ? 'bg-acento/10' : ''}`}
              >
                <td className="px-4 py-2">{p.nombre}</td>
                <td className="px-4 py-2 font-mono">
                  {p.tipo_documento} {p.numero_documento}
                </td>
                <td className="px-4 py-2">{p.condicion_iva}</td>
                <td className="px-4 py-2">
                  {p.activo ? (
                    <span className="text-exito">Activo</span>
                  ) : (
                    <span className="text-neutral-400">Inactivo</span>
                  )}
                </td>
              </tr>
            ))}
            {!buscando && termino.trim().length >= 2 && proveedores.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-neutral-400">
                  Sin resultados.
                </td>
              </tr>
            )}
            {termino.trim().length < 2 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-neutral-400">
                  Escribí al menos 2 caracteres para buscar, o F2 para dar de alta uno nuevo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-neutral-400">
        {proveedorSeleccionado ? 'F1 editar · F2 nuevo proveedor · Esc para volver' : 'F2 nuevo proveedor · Esc para volver'}
      </div>

      {editarAbierto && proveedorSeleccionado && (
        <EditarProveedor proveedor={proveedorSeleccionado} onGuardado={onGuardado} onCancelar={() => setEditarAbierto(false)} />
      )}
      {crearAbierto && <CrearProveedor onCreado={onCreado} onCancelar={() => setCrearAbierto(false)} />}
    </div>
  );
}
