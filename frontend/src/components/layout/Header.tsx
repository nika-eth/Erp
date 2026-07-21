import { useEffect, useState } from 'react';
import { obtenerEstadoAfip } from '../../api/afip';
import { useAuth } from '../../context/AuthContext';
import type { EstadoServicioAfip } from '../../types/domain';

const ETIQUETAS_MODULO: Record<string, string> = {
  PUNTO_MUERTO: 'Punto Muerto',
  CARGA_UNIFICADA: 'Carga Unificada (F5)',
  HISTORIAL: 'Historial de Documentos (F3)',
  CUENTA_CORRIENTE: 'Ficha de Cuenta Corriente (F9)',
  LOGISTICA: 'Control de Ruteo y Ocupación Diaria (F4)',
  PRODUCTOS: 'Gestión de Productos (F7)',
  CUENTAS_PAGAR: 'Cuentas por Pagar (F8)',
};

const INTERVALO_POLL_AFIP_MS = 30_000;

/** Indicador global de AFIP: verde/online, o amarillo con la cantidad de comprobantes en contingencia/fallados. Se consulta al montar y cada 30s. */
function IndicadorAfip(): JSX.Element | null {
  const [estado, setEstado] = useState<EstadoServicioAfip | null>(null);

  useEffect(() => {
    let cancelado = false;
    async function consultar(): Promise<void> {
      try {
        const resultado = await obtenerEstadoAfip();
        if (!cancelado) setEstado(resultado);
      } catch {
        // Si el propio endpoint de estado falla (ej. backend caído), no
        // rompemos el Header: simplemente no se muestra el indicador.
      }
    }
    void consultar();
    const intervalo = setInterval(() => void consultar(), INTERVALO_POLL_AFIP_MS);
    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
  }, []);

  if (!estado) return null;

  const pendientes = estado.tareas_pendientes + estado.tareas_falladas;

  if (estado.online) {
    return (
      <div className="flex items-center gap-1.5 rounded bg-green-50 px-2 py-1 text-xs font-medium text-exito" title="AFIP: sin comprobantes pendientes de sincronizar">
        <span className="h-1.5 w-1.5 rounded-full bg-exito" />
        AFIP
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800"
      title={`${estado.tareas_pendientes} comprobante(s) en contingencia, ${estado.tareas_falladas} fallado(s) requieren revisión`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      AFIP · Contingencia ({pendientes})
    </div>
  );
}

export function Header({ moduloActivo }: { moduloActivo: string }): JSX.Element {
  const { user, sucursal, cerrarSesion } = useAuth();

  return (
    <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
      <div className="flex items-center gap-4">
        <span className="text-base font-semibold text-neutral-900">ERP Metalúrgica</span>
        <span className="rounded bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600">
          {ETIQUETAS_MODULO[moduloActivo] ?? moduloActivo}
        </span>
        <IndicadorAfip />
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
