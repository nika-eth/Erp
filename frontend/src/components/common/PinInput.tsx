import { useEffect, useRef } from 'react';

const LARGO = 4;

interface PinInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * PIN de 4 dígitos en casilleros separados, con foco automático al
 * siguiente casillero al tipear y navegación con flechas/Backspace — para
 * que el supervisor lo cargue rápido desde el teclado sin tocar el mouse.
 */
export function PinInput({ value, onChange, onComplete, disabled, autoFocus }: PinInputProps): JSX.Element {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  // Si el valor se vacía desde afuera (ej. el padre lo resetea tras un PIN
  // incorrecto), volver el foco al primer casillero para reintentar rápido
  // en vez de dejarlo en el último casillero tipeado.
  useEffect(() => {
    if (value === '' && !disabled) refs.current[0]?.focus();
  }, [value, disabled]);

  function setDigito(indice: number, digito: string): void {
    const digitos = value.padEnd(LARGO, ' ').split('');
    digitos[indice] = digito;
    const nuevoValor = digitos.join('').trimEnd();
    onChange(nuevoValor);
    if (digito && indice < LARGO - 1) {
      refs.current[indice + 1]?.focus();
    }
    if (nuevoValor.length === LARGO && !nuevoValor.includes(' ')) {
      onComplete(nuevoValor);
    }
  }

  function onKeyDown(indice: number, event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (value[indice]) {
        setDigito(indice, '');
      } else if (indice > 0) {
        refs.current[indice - 1]?.focus();
        setDigito(indice - 1, '');
      }
    } else if (event.key === 'ArrowLeft' && indice > 0) {
      event.preventDefault();
      refs.current[indice - 1]?.focus();
    } else if (event.key === 'ArrowRight' && indice < LARGO - 1) {
      event.preventDefault();
      refs.current[indice + 1]?.focus();
    } else if (/^\d$/.test(event.key)) {
      event.preventDefault();
      setDigito(indice, event.key);
    } else if (event.key !== 'Tab') {
      event.preventDefault();
    }
  }

  return (
    <div className="flex gap-2">
      {Array.from({ length: LARGO }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={value[i] ?? ''}
          onChange={() => {
            /* la escritura real se maneja en onKeyDown para controlar el foco dígito a dígito */
          }}
          onKeyDown={(e) => onKeyDown(i, e)}
          disabled={disabled}
          inputMode="numeric"
          maxLength={1}
          className="h-12 w-12 rounded border border-neutral-300 text-center text-xl font-mono focus:border-acento disabled:bg-neutral-50"
        />
      ))}
    </div>
  );
}
