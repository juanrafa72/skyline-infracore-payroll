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

/**
 * Días trabajados × tarifa diaria de la cuadrilla.
 *
 * Para las cuadrillas que cobran un precio FIJO por día en vez de por pie
 * construido. La cuenta es la misma que la de un equipo rentado —días por
 * tarifa— pero el beneficiario es el CONTRATISTA, no un proveedor.
 */
export function crewDailyTotal(daysTotal: number, appliedDailyRate: Cents): Cents {
  if (daysTotal < 0) throw new Error('Los días de una cuadrilla no pueden ser negativos.')
  return multiplyQuantity(appliedDailyRate, String(daysTotal))
}
