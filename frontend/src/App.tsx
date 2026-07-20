import { useCallback, useState } from 'react';
import { CargaUnificada } from './components/modules/CargaUnificada/CargaUnificada';
import { FichaCuentaCorriente } from './components/modules/FichaCuentaCorriente';
import { HistorialDocumentos } from './components/modules/HistorialDocumentos';
import { Header } from './components/layout/Header';
import { LoginGate } from './components/layout/LoginGate';
import { PuntoMuerto } from './components/layout/PuntoMuerto';
import { useSession } from './context/SessionContext';
import { useGlobalHotkeys } from './hooks/useGlobalHotkeys';

type Modulo = 'PUNTO_MUERTO' | 'CARGA_UNIFICADA' | 'HISTORIAL' | 'CUENTA_CORRIENTE';

function Mostrador(): JSX.Element {
  const [modulo, setModulo] = useState<Modulo>('PUNTO_MUERTO');

  const volverAPuntoMuerto = useCallback(() => setModulo('PUNTO_MUERTO'), []);

  // Atajos de nivel superior: sólo activos en Punto Muerto. Cada módulo
  // maneja sus propios atajos internos (F1/F2/F12 en Carga Unificada) y su
  // propio `Esc` para volver acá.
  useGlobalHotkeys(
    {
      F5: () => setModulo('CARGA_UNIFICADA'),
      F3: () => setModulo('HISTORIAL'),
      F9: () => setModulo('CUENTA_CORRIENTE'),
    },
    modulo === 'PUNTO_MUERTO',
  );

  return (
    <div className="flex h-screen flex-col">
      <Header moduloActivo={modulo} />
      <main className="flex-1 overflow-hidden">
        {modulo === 'PUNTO_MUERTO' && <PuntoMuerto />}
        {modulo === 'CARGA_UNIFICADA' && <CargaUnificada onSalir={volverAPuntoMuerto} />}
        {modulo === 'HISTORIAL' && <HistorialDocumentos onSalir={volverAPuntoMuerto} />}
        {modulo === 'CUENTA_CORRIENTE' && <FichaCuentaCorriente onSalir={volverAPuntoMuerto} />}
      </main>
    </div>
  );
}

export default function App(): JSX.Element {
  const { estaAutenticado } = useSession();
  return estaAutenticado ? <Mostrador /> : <LoginGate />;
}
