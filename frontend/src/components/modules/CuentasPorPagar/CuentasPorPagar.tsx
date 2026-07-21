import { useState } from 'react';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import { CargarFacturaProveedor } from './CargarFacturaProveedor';
import { CargarNotaCreditoProveedor } from './CargarNotaCreditoProveedor';
import { FichaEmisionOrdenPago } from './FichaEmisionOrdenPago';
import { GestionProveedores } from './GestionProveedores';

type Vista = 'MENU' | 'PROVEEDORES' | 'FACTURA' | 'NOTA_CREDITO' | 'ORDEN_PAGO';

const ATAJOS = [
  { tecla: 'F1', descripcion: 'Gestión de Proveedores (alta y edición)' },
  { tecla: 'F2', descripcion: 'Cargar Factura de Proveedor' },
  { tecla: 'F3', descripcion: 'Cargar Nota de Crédito de Proveedor' },
  { tecla: 'F4', descripcion: 'Emitir Orden de Pago' },
];

/** Módulo de Cuentas por Pagar (F8, sólo ADMIN/SUPERVISOR). Hub de navegación hacia las pantallas de datos maestros. */
export function CuentasPorPagar({ onSalir }: { onSalir: () => void }): JSX.Element {
  const [vista, setVista] = useState<Vista>('MENU');
  const volverAlMenu = () => setVista('MENU');

  useGlobalHotkeys(
    {
      F1: () => setVista('PROVEEDORES'),
      F2: () => setVista('FACTURA'),
      F3: () => setVista('NOTA_CREDITO'),
      F4: () => setVista('ORDEN_PAGO'),
      Escape: onSalir,
    },
    vista === 'MENU',
  );

  if (vista === 'PROVEEDORES') return <GestionProveedores onSalir={volverAlMenu} />;
  if (vista === 'FACTURA') return <CargarFacturaProveedor onSalir={volverAlMenu} />;
  if (vista === 'NOTA_CREDITO') return <CargarNotaCreditoProveedor onSalir={volverAlMenu} />;
  if (vista === 'ORDEN_PAGO') return <FichaEmisionOrdenPago onSalir={volverAlMenu} />;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-white">
      <p className="text-sm uppercase tracking-widest text-neutral-300">Cuentas por Pagar</p>
      <div className="flex gap-8">
        {ATAJOS.map((a) => (
          <div key={a.tecla} className="flex flex-col items-center gap-2">
            <kbd className="rounded border border-neutral-300 bg-neutral-50 px-3 py-1.5 font-mono text-sm text-neutral-700">
              {a.tecla}
            </kbd>
            <span className="max-w-[10rem] text-center text-xs text-neutral-500">{a.descripcion}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-neutral-400">Esc para volver</p>
    </div>
  );
}
