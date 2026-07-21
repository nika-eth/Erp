import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

export type HotkeyKey = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9' | 'F12' | 'Escape' | 'Backspace';

export type HotkeyMap = Partial<Record<HotkeyKey, (event: KeyboardEvent) => void>>;

const HotkeySuspensionContext = createContext(false);

/**
 * Suspende TODOS los atajos registrados con `useGlobalHotkeys` en los
 * componentes descendientes, a cualquier profundidad (incluye modales
 * anidados como Rendición de Pago o el catálogo de materiales), mientras
 * `suspendido` sea true.
 *
 * La usa el overlay global de Ficha de Cuenta Corriente (F9): al abrirse
 * encima de cualquier pantalla, envuelve el resto de la app en este límite
 * para que ningún atajo del módulo que quedó debajo reaccione a las teclas
 * mientras la ficha está abierta — sin tener que pasarle un flag "activo" a
 * mano a cada módulo y a cada modal anidado.
 */
export function HotkeySuspensionBoundary({
  suspendido,
  children,
}: {
  suspendido: boolean;
  children: ReactNode;
}): JSX.Element {
  return <HotkeySuspensionContext.Provider value={suspendido}>{children}</HotkeySuspensionContext.Provider>;
}

/**
 * Suscribe atajos de teclado globales para el uso 100% teclado del
 * mostrador. Previene el comportamiento por defecto del navegador
 * (F5 = recargar, F3 = buscar en página, F1 = ayuda, etc.) para las teclas
 * que efectivamente maneja este mapa.
 *
 * Cada pantalla/módulo llama a este hook con su propio mapa de atajos y un
 * flag `enabled`; como sólo una pantalla suele estar habilitada a la vez,
 * no hace falta coordinar prioridad entre listeners salvo que estén dentro
 * de un `HotkeySuspensionBoundary` suspendido (ver más arriba).
 */
export function useGlobalHotkeys(handlers: HotkeyMap, enabled = true): void {
  const suspendido = useContext(HotkeySuspensionContext);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const habilitado = enabled && !suspendido;

  useEffect(() => {
    if (!habilitado) return;

    function onKeyDown(event: KeyboardEvent): void {
      const handler = handlersRef.current[event.key as HotkeyKey];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [habilitado]);
}
