import { useEffect, useState, type FormEvent } from 'react';
import { login } from '../../api/auth';
import { ApiError } from '../../api/client';
import { listarSucursales } from '../../api/catalogos';
import { ROLES, useSession } from '../../context/SessionContext';
import type { Rol, Sucursal } from '../../types/domain';

/**
 * Puerta de acceso previa al mostrador. El modelo de datos provisto no
 * incluye una tabla `usuarios`, así que en vez de credenciales se pide
 * sucursal + rol + nombre de vendedor; esto ata la sesión a una sucursal
 * tal como pide la regla de "Identidad por Sesión".
 */
export function LoginGate(): JSX.Element {
  const { iniciarSesion } = useSession();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [idSucursal, setIdSucursal] = useState<number | ''>('');
  const [rol, setRol] = useState<Rol>('VENDEDOR');
  const [vendedor, setVendedor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    listarSucursales()
      .then((res) => {
        setSucursales(res.sucursales);
        if (res.sucursales[0]) setIdSucursal(res.sucursales[0].id_sucursal);
      })
      .catch(() => setError('No se pudo conectar con el servidor.'));
  }, []);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (idSucursal === '' || !vendedor.trim()) return;

    setCargando(true);
    setError(null);
    try {
      const { token, sesion, sucursal } = await login(idSucursal, rol, vendedor);
      iniciarSesion(token, sesion, sucursal);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error inesperado al iniciar sesión.');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-white">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-lg border border-neutral-200 p-6">
        <h1 className="mb-1 text-lg font-semibold text-neutral-900">ERP Metalúrgica</h1>
        <p className="mb-6 text-sm text-neutral-500">Iniciar turno de mostrador</p>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-neutral-600">Sucursal</span>
          <select
            autoFocus
            value={idSucursal}
            onChange={(e) => setIdSucursal(Number(e.target.value))}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          >
            {sucursales.map((s) => (
              <option key={s.id_sucursal} value={s.id_sucursal}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-neutral-600">Rol</span>
          <select
            value={rol}
            onChange={(e) => setRol(e.target.value as Rol)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-neutral-600">Vendedor</span>
          <input
            value={vendedor}
            onChange={(e) => setVendedor(e.target.value)}
            placeholder="Nombre y apellido"
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        {error && <p className="mb-4 text-sm text-peligro">{error}</p>}

        <button
          type="submit"
          disabled={cargando || idSucursal === '' || !vendedor.trim()}
          className="w-full rounded bg-acento py-2 text-sm font-medium text-white hover:bg-acento-hover disabled:opacity-50"
        >
          {cargando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
