import type { CompensationType, RateType } from '@/lib/payroll/engine/types'

/**
 * Quién tiene tarifa y quién no — la parte pura.
 *
 * Hasta ahora convivían TRES respuestas distintas a "¿tiene tarifa?": el
 * dashboard contaba cualquier tarifa activa (sin mirar fechas), la ficha del
 * trabajador filtraba por vigencia a hoy, y el motor usaba `resolveRate`, que
 * es la única que decide lo que se paga. Este módulo existe para que quede UNA
 * sola definición: la del motor.
 */

/**
 * Qué tipo de tarifa necesita una persona según su forma de pago.
 *
 * Devuelve `null` para las formas que no llevan tarifa de costo (producción,
 * pieza, porcentaje, liquidación, manual): a esas personas una WorkerRate no
 * les arregla nada, y contarlas como "sin tarifa" infla el número con gente
 * que no tiene nada pendiente.
 */
export function rateTypeFor(compensationType: CompensationType): RateType | null {
  switch (compensationType) {
    case 'DAILY_RATE':
      return 'DAILY'
    case 'HOURLY':
      return 'HOURLY'
    case 'FIXED_WEEKLY':
      return 'WEEKLY'
    default:
      return null
  }
}

export interface RateStatusRow {
  workerId: string
  name: string
  code: string
  compensationType: CompensationType
  /** Tipo de tarifa que le corresponde (DAILY/HOURLY/WEEKLY). */
  rateType: RateType
  /** Monto resuelto como cadena con 2 decimales, o null si no hay tarifa. */
  resolvedAmount: string | null
  /** Qué tarifa concreta resolvió. Sirve para saber si es provisional. */
  resolvedRateId: string | null
  /** Por qué no hay tarifa, en cristiano. Solo cuando resolvedAmount es null. */
  why: string | null
}

/** Cómo se reconoce una tarifa puesta solo para destrabar. */
export const NOTA_PROVISIONAL = 'PROVISIONAL $1 — falta la tarifa real'

export interface RatesStatus {
  /** Personas cuya forma de pago SÍ lleva tarifa. */
  needsRate: readonly RateStatusRow[]
  /** El subconjunto que hoy no resuelve ninguna: son las que bloquean. */
  missing: readonly RateStatusRow[]
  /**
   * Las que tienen una tarifa PROVISIONAL de $1.
   *
   * Ya no bloquean el envío —para eso se pusieron— pero **no son la tarifa de
   * nadie**: quien se quede así cobra $5 por una semana en vez de $650, y eso
   * ningún error lo avisa. Por eso se listan aparte y bien visibles.
   */
  provisional: readonly RateStatusRow[]
  /** Personas que no llevan tarifa de costo (producción, manual, etc.). */
  nonRateBased: ReadonlyArray<{
    workerId: string
    name: string
    compensationType: CompensationType
  }>
}
