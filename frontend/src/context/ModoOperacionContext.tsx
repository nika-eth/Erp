import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ModoOperacion = 'FISCAL' | 'INTERNA';

interface ModoOperacionContextValue {
  modo: ModoOperacion;
  toggle: () => void;
}

const ModoOperacionContext = createContext<ModoOperacionContextValue | null>(null);

const STORAGE_KEY = 'erp:modo_operacion';

function leerModoInicial(): ModoOperacion {
  return sessionStorage.getItem(STORAGE_KEY) === 'INTERNA' ? 'INTERNA' : 'FISCAL';
}

/**
 * Contexto acotado a Carga Unificada (se monta ahí, no en el árbol global de
 * `App.tsx`): decide si el cajero está operando en modo FISCAL o INTERNA
 * *antes* de cargar la venta, no al confirmar el pago como antes (F5/F6 en
 * `RendicionPago.tsx`, ahora colapsados en un solo atajo que sigue este
 * modo — dos fuentes de verdad para lo mismo era el riesgo real: pantalla
 * fucsia pero F5 fiscal por costumbre).
 *
 * Persistido en `sessionStorage` (no `localStorage`): el contexto se
 * resetea a FISCAL si cierran la pestaña o cambian de turno, para que un
 * cajero nuevo no herede el modo INTERNA del turno anterior por descuido.
 */
export function ModoOperacionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [modo, setModo] = useState<ModoOperacion>(leerModoInicial);

  const toggle = useCallback(() => {
    setModo((actual) => {
      const siguiente: ModoOperacion = actual === 'FISCAL' ? 'INTERNA' : 'FISCAL';
      sessionStorage.setItem(STORAGE_KEY, siguiente);
      return siguiente;
    });
  }, []);

  const value = useMemo(() => ({ modo, toggle }), [modo, toggle]);

  return <ModoOperacionContext.Provider value={value}>{children}</ModoOperacionContext.Provider>;
}

export function useModoOperacion(): ModoOperacionContextValue {
  const ctx = useContext(ModoOperacionContext);
  if (!ctx) throw new Error('useModoOperacion debe usarse dentro de ModoOperacionProvider');
  return ctx;
}
