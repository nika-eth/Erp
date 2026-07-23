const ATAJOS = [
  { tecla: 'F5', descripcion: 'Carga Unificada (nueva venta / presupuesto)' },
  { tecla: 'F3', descripcion: 'Historial de Documentos' },
  { tecla: 'F9', descripcion: 'Ficha de Cuenta Corriente' },
  { tecla: 'F4', descripcion: 'Control de Ruteo y Ocupación Diaria' },
  { tecla: 'F6', descripcion: 'Retirar Orden de Entrega' },
  { tecla: 'F10', descripcion: 'Pizarra de Camiones (envíos a domicilio)' },
];

const ATAJO_PRODUCTOS = { tecla: 'F7', descripcion: 'Gestión de Productos' };
const ATAJO_CUENTAS_PAGAR = { tecla: 'F8', descripcion: 'Cuentas por Pagar' };

/**
 * Pantalla vacía en espera de atajos: el estado de reposo del mostrador.
 * F7 sólo se muestra a ADMIN; F8 (Cuentas por Pagar) a ADMIN/SUPERVISOR.
 */
export function PuntoMuerto({ esAdmin, esAdminOSupervisor }: { esAdmin: boolean; esAdminOSupervisor: boolean }): JSX.Element {
  const atajos = [...ATAJOS, ...(esAdmin ? [ATAJO_PRODUCTOS] : []), ...(esAdminOSupervisor ? [ATAJO_CUENTAS_PAGAR] : [])];

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-white">
      <p className="text-sm uppercase tracking-widest text-neutral-300">Punto muerto</p>
      <div className="flex gap-8">
        {atajos.map((a) => (
          <div key={a.tecla} className="flex flex-col items-center gap-2">
            <kbd className="rounded border border-neutral-300 bg-neutral-50 px-3 py-1.5 font-mono text-sm text-neutral-700">
              {a.tecla}
            </kbd>
            <span className="max-w-[10rem] text-center text-xs text-neutral-500">{a.descripcion}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
