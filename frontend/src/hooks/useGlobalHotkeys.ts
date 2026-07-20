import { useEffect, useRef } from 'react';

export type HotkeyKey = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F9' | 'F12' | 'Escape' | 'Backspace';

export type HotkeyMap = Partial<Record<HotkeyKey, (event: KeyboardEvent) => void>>;

/**
 * Suscribe atajos de teclado globales para el uso 100% teclado del
 * mostrador. Previene el comportamiento por defecto del navegador
 * (F5 = recargar, F3 = buscar en página, F1 = ayuda, etc.) para las teclas
 * que efectivamente maneja este mapa.
 *
 * Cada pantalla/módulo llama a este hook con su propio mapa de atajos y un
 * flag `enabled`; como sólo una pantalla suele estar habilitada a la vez
 * (ver `ModuleContext`), no hace falta coordinar prioridad entre listeners.
 */
export function useGlobalHotkeys(handlers: HotkeyMap, enabled = true): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent): void {
      const handler = handlersRef.current[event.key as HotkeyKey];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
