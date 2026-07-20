import { useState, type FormEvent } from 'react';
import { login } from '../../api/auth';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

/**
 * Puerta de acceso previa al mostrador. La sucursal y el rol no se eligen
 * acá: quedan atados al usuario autenticado y viajan firmados dentro del
 * JWT (ver `UserPayload`), para que no se puedan manipular desde el cliente.
 */
export function LoginGate(): JSX.Element {
  const { iniciarSesion } = useAuth();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!usuario.trim() || !password) return;

    setCargando(true);
    setError(null);
    try {
      const { token, user, sucursal } = await login(usuario.trim(), password);
      iniciarSesion(token, user, sucursal);
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
          <span className="mb-1 block text-neutral-600">Usuario</span>
          <input
            autoFocus
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            placeholder="usuario"
            autoComplete="username"
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-neutral-600">Contraseña</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        {error && <p className="mb-4 text-sm text-peligro">{error}</p>}

        <button
          type="submit"
          disabled={cargando || !usuario.trim() || !password}
          className="w-full rounded bg-acento py-2 text-sm font-medium text-white hover:bg-acento-hover disabled:opacity-50"
        >
          {cargando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
