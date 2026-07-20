import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { clearToken, setToken as persistToken } from '../api/client';
import type { Rol, SesionUsuario, Sucursal } from '../types/domain';

interface SessionContextValue {
  sesion: SesionUsuario | null;
  sucursal: Sucursal | null;
  estaAutenticado: boolean;
  iniciarSesion: (token: string, sesion: SesionUsuario, sucursal: Sucursal) => void;
  cerrarSesion: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const SESION_STORAGE_KEY = 'erp:sesion';
const SUCURSAL_STORAGE_KEY = 'erp:sucursal';

function leerDeStorage<T>(clave: string): T | null {
  const raw = localStorage.getItem(clave);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [sesion, setSesion] = useState<SesionUsuario | null>(() => leerDeStorage(SESION_STORAGE_KEY));
  const [sucursal, setSucursal] = useState<Sucursal | null>(() => leerDeStorage(SUCURSAL_STORAGE_KEY));

  const iniciarSesion = useCallback((token: string, nuevaSesion: SesionUsuario, nuevaSucursal: Sucursal) => {
    persistToken(token);
    localStorage.setItem(SESION_STORAGE_KEY, JSON.stringify(nuevaSesion));
    localStorage.setItem(SUCURSAL_STORAGE_KEY, JSON.stringify(nuevaSucursal));
    setSesion(nuevaSesion);
    setSucursal(nuevaSucursal);
  }, []);

  const cerrarSesion = useCallback(() => {
    clearToken();
    localStorage.removeItem(SESION_STORAGE_KEY);
    localStorage.removeItem(SUCURSAL_STORAGE_KEY);
    setSesion(null);
    setSucursal(null);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ sesion, sucursal, estaAutenticado: sesion !== null, iniciarSesion, cerrarSesion }),
    [sesion, sucursal, iniciarSesion, cerrarSesion],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession debe usarse dentro de <SessionProvider>');
  return ctx;
}

export const ROLES: Rol[] = ['ADMIN', 'SUPERVISOR', 'VENDEDOR'];
