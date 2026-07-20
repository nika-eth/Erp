import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { clearToken, setToken as persistToken } from '../api/client';
import type { Sucursal, UserPayload } from '../types/domain';

interface AuthContextValue {
  user: UserPayload | null;
  sucursal: Sucursal | null;
  estaAutenticado: boolean;
  iniciarSesion: (token: string, user: UserPayload, sucursal: Sucursal) => void;
  cerrarSesion: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_STORAGE_KEY = 'erp:user';
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

/**
 * `id_sucursal` viaja firmado dentro del JWT (ver `UserPayload`): este
 * contexto sólo lo refleja para la UI, no lo elige quien inicia sesión.
 */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<UserPayload | null>(() => leerDeStorage(USER_STORAGE_KEY));
  const [sucursal, setSucursal] = useState<Sucursal | null>(() => leerDeStorage(SUCURSAL_STORAGE_KEY));

  const iniciarSesion = useCallback((token: string, nuevoUser: UserPayload, nuevaSucursal: Sucursal) => {
    persistToken(token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nuevoUser));
    localStorage.setItem(SUCURSAL_STORAGE_KEY, JSON.stringify(nuevaSucursal));
    setUser(nuevoUser);
    setSucursal(nuevaSucursal);
  }, []);

  const cerrarSesion = useCallback(() => {
    clearToken();
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(SUCURSAL_STORAGE_KEY);
    setUser(null);
    setSucursal(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, sucursal, estaAutenticado: user !== null, iniciarSesion, cerrarSesion }),
    [user, sucursal, iniciarSesion, cerrarSesion],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
