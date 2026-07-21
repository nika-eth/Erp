import { useCallback, useState } from 'react';
import { CargaUnificada } from './components/modules/CargaUnificada/CargaUnificada';
import { FichaCuentaCorriente } from './components/modules/CuentaCorriente/FichaCuentaCorriente';
import { GestionProductos } from './components/modules/GestionProductos';
import { HistorialDocumentos } from './components/modules/HistorialDocumentos';
import { ControlRuteo } from './components/modules/Logistica/ControlRuteo';
import { Header } from './components/layout/Header';
import { LoginGate } from './components/layout/LoginGate';
import { PuntoMuerto } from './components/layout/PuntoMuerto';
import { useAuth } from './context/AuthContext';
import { HotkeySuspensionBoundary, useGlobalHotkeys } from './hooks/useGlobalHotkeys';

type Modulo = 'PUNTO_MUERTO' | 'CARGA_UNIFICADA' | 'HISTORIAL' | 'LOGISTICA' | 'PRODUCTOS';

function Mostrador(): JSX.Element {
  const [modulo, setModulo] = useState<Modulo>('PUNTO_MUERTO');
  const [fichaAbierta, setFichaAbierta] = useState(false);

  const volverAPuntoMuerto = useCallback(() => setModulo('PUNTO_MUERTO'), []);
  const cerrarFicha = useCallback(() => setFichaAbierta(false), []);

  // Atajos de nivel superior: F5/F3/F4 sólo activos en Punto Muerto. Cada
  // módulo maneja sus propios atajos internos (F1/F2/F12 en Carga
  // Unificada, F1 en Logística) y su propio `Esc` para volver acá.
  useGlobalHotkeys(
    {
      F5: () => setModulo('CARGA_UNIFICADA'),
      F3: () => setModulo('HISTORIAL'),
      F4: () => setModulo('LOGISTICA'),
      F7: () => setModulo('PRODUCTOS'),
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
          {modulo === 'PUNTO_MUERTO' && <PuntoMuerto />}
          {modulo === 'CARGA_UNIFICADA' && <CargaUnificada onSalir={volverAPuntoMuerto} />}
          {modulo === 'HISTORIAL' && <HistorialDocumentos onSalir={volverAPuntoMuerto} />}
          {modulo === 'LOGISTICA' && <ControlRuteo onSalir={volverAPuntoMuerto} />}
          {modulo === 'PRODUCTOS' && <GestionProductos onSalir={volverAPuntoMuerto} />}
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
