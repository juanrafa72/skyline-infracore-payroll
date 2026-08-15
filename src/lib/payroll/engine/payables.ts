import { type Cents, ZERO, add, multiplyQuantity, toCents } from './money'

/**
 * Totales de los pagables que no son personas: cuadrillas y equipos.
 *
 * Puro y en centavos enteros, como todo lo que termina saliendo del banco.
 */

/** Σ de montos que vienen de la base como cadenas con 2 decimales. */
export function sumProductionAmounts(amounts: readonly string[]): Cents {
  return amounts.reduce<Cents>((total, amount) => add(total, toCents(amount)), ZERO)
}

/** Días marcados × costo diario congelado. */
export function equipmentTotal(daysTotal: number, appliedDailyCost: Cents): Cents {
  if (daysTotal < 0) throw new Error('Los días de un equipo no pueden ser negativos.')
  return multiplyQuantity(appliedDailyCost, String(daysTotal))
}
