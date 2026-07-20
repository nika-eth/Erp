import { useAuth } from '../../context/AuthContext';

const ETIQUETAS_MODULO: Record<string, string> = {
  PUNTO_MUERTO: 'Punto Muerto',
  CARGA_UNIFICADA: 'Carga Unificada (F5)',
  HISTORIAL: 'Historial de Documentos (F3)',
  CUENTA_CORRIENTE: 'Ficha de Cuenta Corriente (F9)',
  LOGISTICA: 'Control de Ruteo y Ocupación Diaria (F4)',
};

export function Header({ moduloActivo }: { moduloActivo: string }): JSX.Element {
  const { user, sucursal, cerrarSesion } = useAuth();

  return (
    <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
      <div className="flex items-center gap-4">
        <span className="text-base font-semibold text-neutral-900">ERP Metalúrgica</span>
        <span className="rounded bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600">
          {ETIQUETAS_MODULO[moduloActivo] ?? moduloActivo}
        </span>
      </div>

      <div className="flex items-center gap-4 text-sm">
        <div className="text-right">
          <div className="font-medium text-neutral-900">{sucursal?.nombre ?? '—'}</div>
          <div className="text-xs text-neutral-500">
            {user?.nombre} · {user?.rol}
          </div>
        </div>
        <button
          type="button"
          tabIndex={-1}
          onClick={cerrarSesion}
          className="rounded border border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-50"
        >
          Cerrar sesión
        </button>
      </div>
    </header>
  );
}
