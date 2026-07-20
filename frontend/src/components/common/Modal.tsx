import type { ReactNode } from 'react';

interface ModalProps {
  titulo: string;
  children: ReactNode;
  ancho?: 'md' | 'lg' | 'xl';
}

const ANCHOS: Record<NonNullable<ModalProps['ancho']>, string> = {
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/**
 * Modal flotante sobre fondo blanco semi-transparente. El cierre se maneja
 * siempre desde el atajo `Esc` del módulo que lo invoca, no con un botón de
 * mouse, para respetar el flujo 100% teclado.
 */
export function Modal({ titulo, children, ancho = 'lg' }: ModalProps): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-900/20 pt-16">
      <div className={`w-full ${ANCHOS[ancho]} rounded-lg border border-neutral-200 bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">{titulo}</h2>
          <span className="text-xs text-neutral-400">Esc para cerrar</span>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
