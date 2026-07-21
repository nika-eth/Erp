import type { UnidadIngresoCantidad } from '../types/domain';

/** Mismo margen de tolerancia que usa el backend (`resolverCantidadUnidades` en `documento.utils.ts`). */
export const EPSILON_UNIDADES = 0.01;

export interface ResolucionCantidad {
  valido: boolean;
  /** Cantidad ya resuelta a unidades enteras; 0 si `valido` es false. */
  cantidadUnidades: number;
  /** Mensaje de error a mostrar si `valido` es false. */
  mensaje: string | null;
  /** Sólo en modo 'U': el equivalente en kilos, informativo (no bloquea). */
  equivalenteKg: number | null;
}

/**
 * Valida en el cliente la equivalencia kilos -> unidades enteras, con el
 * mismo cálculo y tolerancia que el backend (`resolverCantidadUnidades`),
 * para dar feedback inmediato en el mostrador. El backend siempre vuelve a
 * validar de forma independiente antes de persistir nada — esto es sólo UX.
 */
export function resolverCantidadUnidades(
  cantidadIngresada: number,
  unidadIngreso: UnidadIngresoCantidad,
  pesoTeoricoKg: number,
): ResolucionCantidad {
  if (unidadIngreso === 'U') {
    const entera = Number.isInteger(cantidadIngresada) && cantidadIngresada > 0;
    return {
      valido: entera,
      cantidadUnidades: entera ? cantidadIngresada : 0,
      mensaje: entera ? null : 'La cantidad de unidades debe ser un número entero mayor a 0.',
      equivalenteKg: Math.round(cantidadIngresada * pesoTeoricoKg * 100) / 100,
    };
  }

  if (pesoTeoricoKg <= 0) {
    return {
      valido: false,
      cantidadUnidades: 0,
      mensaje: 'Este producto no tiene peso teórico cargado; no se puede vender por kilos.',
      equivalenteKg: null,
    };
  }

  const unidadesCalculadas = cantidadIngresada / pesoTeoricoKg;
  const unidadesEnteras = Math.round(unidadesCalculadas);
  const diferencia = Math.abs(unidadesCalculadas - unidadesEnteras);
  const valido = diferencia <= EPSILON_UNIDADES && unidadesEnteras > 0;

  return {
    valido,
    cantidadUnidades: valido ? unidadesEnteras : 0,
    mensaje: valido
      ? null
      : `Error: Los kilos ingresados no equivalen a unidades enteras. (1 U = ${pesoTeoricoKg}kg)`,
    equivalenteKg: null,
  };
}
