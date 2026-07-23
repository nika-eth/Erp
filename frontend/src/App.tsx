import { useCallback, useState } from 'react';
import { CargaUnificada } from './components/modules/CargaUnificada/CargaUnificada';
import { FichaCuentaCorriente } from './components/modules/CuentaCorriente/FichaCuentaCorriente';
import { CuentasPorPagar } from './components/modules/CuentasPorPagar/CuentasPorPagar';
import { GestionProductos } from './components/modules/GestionProductos';
import { HistorialDocumentos } from './components/modules/HistorialDocumentos';
import { RetirarOrdenEntrega } from './components/modules/RetirarOrdenEntrega';
import { ControlRuteo } from './components/modules/Logistica/ControlRuteo';
import { Header } from './components/layout/Header';
import { LoginGate } from './components/layout/LoginGate';
import { PuntoMuerto } from './components/layout/PuntoMuerto';
import { useAuth } from './context/AuthContext';
import { HotkeySuspensionBoundary, useGlobalHotkeys } from './hooks/useGlobalHotkeys';

type Modulo = 'PUNTO_MUERTO' | 'CARGA_UNIFICADA' | 'HISTORIAL' | 'LOGISTICA' | 'RETIRO_ORDEN' | 'PRODUCTOS' | 'CUENTAS_PAGAR';

function Mostrador(): JSX.Element {
  const { user } = useAuth();
  const [modulo, setModulo] = useState<Modulo>('PUNTO_MUERTO');
  const [fichaAbierta, setFichaAbierta] = useState(false);
  const esAdmin = user?.rol === 'ADMIN';
  const esAdminOSupervisor = user?.rol === 'ADMIN' || user?.rol === 'SUPERVISOR';

  const volverAPuntoMuerto = useCallback(() => setModulo('PUNTO_MUERTO'), []);
  const cerrarFicha = useCallback(() => setFichaAbierta(false), []);

  // Atajos de nivel superior: F5/F3/F4 sólo activos en Punto Muerto. Cada
  // módulo maneja sus propios atajos internos (F1/F2/F12 en Carga
  // Unificada, F1 en Logística) y su propio `Esc` para volver acá. Gestión
  // de Productos (F7) es sólo ADMIN y Cuentas por Pagar (F8) es sólo
  // ADMIN/SUPERVISOR — el backend ya lo exige (`requireRole(...)` en cada
  // router), así que ocultarlos acá es sólo para no ofrecer un atajo que va
  // a rebotar con 403.
  useGlobalHotkeys(
    {
      F5: () => setModulo('CARGA_UNIFICADA'),
      F3: () => setModulo('HISTORIAL'),
      F4: () => setModulo('LOGISTICA'),
      F6: () => setModulo('RETIRO_ORDEN'),
      ...(esAdmin ? { F7: () => setModulo('PRODUCTOS') } : {}),
      ...(esAdminOSupervisor ? { F8: () => setModulo('CUENTAS_PAGAR') } : {}),
    },
    modulo === 'PUNTO_MUERTO' && !fichaAbierta,
  );

  // F9 funciona desde cualquier pantalla, no sólo Punto Muerto: abre la
  // Ficha de Cuenta Corriente como overlay por encima de lo que esté
  // activo, sin perder el trabajo en curso (ej. un carrito a medio cargar
  // en Carga Unificada, que no se desmonta).
  useGlobalHotkeys({ F9: () => setFichaAbierta(true) }, !fichaAbierta);

  return (
    <div className="flex h-screen flex-col">
      <Header moduloActivo={fichaAbierta ? 'CUENTA_CORRIENTE' : modulo} />
      <main className="flex-1 overflow-hidden">
        <HotkeySuspensionBoundary suspendido={fichaAbierta}>
          {modulo === 'PUNTO_MUERTO' && <PuntoMuerto esAdmin={esAdmin} esAdminOSupervisor={esAdminOSupervisor} />}
          {modulo === 'CARGA_UNIFICADA' && <CargaUnificada onSalir={volverAPuntoMuerto} />}
          {modulo === 'HISTORIAL' && <HistorialDocumentos onSalir={volverAPuntoMuerto} />}
          {modulo === 'LOGISTICA' && <ControlRuteo onSalir={volverAPuntoMuerto} />}
          {modulo === 'RETIRO_ORDEN' && <RetirarOrdenEntrega onSalir={volverAPuntoMuerto} />}
          {modulo === 'PRODUCTOS' && esAdmin && <GestionProductos onSalir={volverAPuntoMuerto} />}
          {modulo === 'CUENTAS_PAGAR' && esAdminOSupervisor && <CuentasPorPagar onSalir={volverAPuntoMuerto} />}
        </HotkeySuspensionBoundary>
      </main>
      {fichaAbierta && <FichaCuentaCorriente onSalir={cerrarFicha} />}
    </div>
  );
}

export default function App(): JSX.Element {
  const { estaAutenticado } = useAuth();
  return estaAutenticado ? <Mostrador /> : <LoginGate />;
}
