/**
 * Resolución de la tarifa de VENTA: lo que el cliente nos paga por un día.
 *
 * Misma forma que `engine/rates.ts`, que resuelve la de costo, y a propósito:
 * son los dos lados del mismo día de trabajo, y quien lea uno debe reconocer
 * el otro. Puro, sin base de datos, sin reloj.
 *
 * La regla que gobierna todo esto: **si no se sabe cuánto se le cobra al
 * cliente, no se inventa**. Se devuelve `null` y el margen queda marcado como
 * incompleto. Poner cero convertiría una venta desconocida en una pérdida
 * inventada, y poner la tarifa de otro cliente sería peor.
 */
import type { Cents } from '@/lib/payroll/engine/money'

export type BillingRateType = 'DAILY' | 'HOURLY' | 'WEEKLY' | 'PIECE' | 'PERCENTAGE'
export type RateShift = 'DAY' | 'NIGHT' | 'ANY'

export interface BillingRateInput {
  id: string
  customerId: string
  projectId: string | null
  operationId: string | null
  crewId: string | null
  shift: RateShift
  rateType: BillingRateType
  amount: Cents
  effectiveFrom: string
  effectiveTo: string | null
}

export interface BillingLookup {
  customerId: string | null
  projectId: string | null
  operationId: string | null
  crewId: string | null
  shift: RateShift
  rateType: BillingRateType
  /** Fecha del día trabajado, en ISO. */
  date: string
}

/** Qué tan específica es una tarifa. Gana la más específica. */
function specificity(rate: BillingRateInput): number {
  return (
    (rate.projectId ? 8 : 0) +
    (rate.crewId ? 4 : 0) +
    (rate.operationId ? 2 : 0) +
    (rate.shift !== 'ANY' ? 1 : 0)
  )
}

function vigente(rate: BillingRateInput, date: string): boolean {
  if (rate.effectiveFrom > date) return false
  if (rate.effectiveTo !== null && rate.effectiveTo < date) return false
  return true
}

/**
 * Busca la tarifa de venta que aplica.
 *
 * Precedencia, de más específica a más general:
 * proyecto+turno → proyecto → cuadrilla → operación → turno → general.
 *
 * Una tarifa amarrada a un proyecto NO aplica a otro proyecto; una amarrada a
 * un turno no aplica al otro. Lo que no encaja se descarta, no se aproxima.
 */
export function resolveBillingRate(
  rates: readonly BillingRateInput[],
  lookup: BillingLookup,
): BillingRateInput | null {
  if (!lookup.customerId) return null

  const candidatas = rates.filter((rate) => {
    if (rate.customerId !== lookup.customerId) return false
    if (rate.rateType !== lookup.rateType) return false
    if (!vigente(rate, lookup.date)) return false
    if (rate.shift !== 'ANY' && rate.shift !== lookup.shift) return false
    if (rate.projectId !== null && rate.projectId !== lookup.projectId) return false
    if (rate.operationId !== null && rate.operationId !== lookup.operationId) return false
    if (rate.crewId !== null && rate.crewId !== lookup.crewId) return false
    return true
  })

  if (candidatas.length === 0) return null

  const ordenadas = [...candidatas].sort((a, b) => {
    const diff = specificity(b) - specificity(a)
    if (diff !== 0) return diff
    // A igual especificidad gana la que empezó después: es la más reciente.
    return a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0
  })

  return ordenadas[0]!
}

/** Por qué no se encontró tarifa de venta, en español y con la causa concreta. */
export function explainMissingBillingRate(
  rates: readonly BillingRateInput[],
  lookup: BillingLookup,
): string {
  if (!lookup.customerId) {
    return 'El proyecto no tiene cliente asignado, así que no se sabe a quién se le factura este día.'
  }

  const delCliente = rates.filter((rate) => rate.customerId === lookup.customerId)
  if (delCliente.length === 0) {
    return 'Ese cliente no tiene ninguna tarifa de venta configurada.'
  }

  const vigentes = delCliente.filter((rate) => vigente(rate, lookup.date))
  if (vigentes.length === 0) {
    return `Ese cliente tiene tarifas de venta, pero ninguna vigente el ${lookup.date}.`
  }

  const delTipo = vigentes.filter((rate) => rate.rateType === lookup.rateType)
  if (delTipo.length === 0) {
    return `Las tarifas de venta vigentes de ese cliente no son del tipo que necesita este día.`
  }

  const delTurno = delTipo.filter((rate) => rate.shift === 'ANY' || rate.shift === lookup.shift)
  if (delTurno.length === 0) {
    const turno = lookup.shift === 'NIGHT' ? 'noche' : 'día'
    return `No hay tarifa de venta para turno de ${turno}. Las que existen son de otro turno.`
  }

  return 'Las tarifas de venta vigentes están amarradas a otro proyecto, otra cuadrilla u otra operación.'
}
