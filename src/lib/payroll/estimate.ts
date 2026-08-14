/**
 * Lo que va sumando una semana mientras se marca.
 *
 * Puro y en centavos enteros, aunque solo alimente una barra en pantalla: es
 * una cifra de dinero que alguien va a mirar para decidir, y toda cifra de
 * dinero pasa por el motor — nunca por aritmética suelta.
 *
 * **Es un estimado y la salida lo declara.** No conoce descuentos, préstamos ni
 * reglas de la compañía; solo días × tarifa más adicionales. El número bueno
 * sale de `calculateWorkerPayroll`.
 */
import { type Cents, ZERO, add, multiplyRatio } from '@/lib/payroll/engine/money'

export interface MarkedDays {
  workerId: string
  name: string
  /** Tarifa diaria. `null` = no se sabe: su plata no se estima. */
  rate: Cents | null
  fullDays: number
  halfDays: number
  extra: Cents
}

export interface EstimateLine {
  name: string
  fullDays: number
  halfDays: number
  extra: Cents
  /** `null` cuando no hay tarifa. NO es cero. */
  subtotal: Cents | null
}

export interface WeekEstimate {
  lines: EstimateLine[]
  people: number
  fullDays: number
  halfDays: number
  /** Días como texto: «5» o «5½». */
  daysLabel: string
  extra: Cents
  /** Suma de los que SÍ tienen tarifa. */
  grand: Cents
  /** Quiénes tienen días pero no tarifa: su plata falta en el total. */
  withoutRate: string[]
}

/** Días en texto. Dos medios días son uno completo. */
export function daysLabel(fullDays: number, halfDays: number): string {
  const whole = fullDays + Math.floor(halfDays / 2)
  const rest = halfDays % 2
  if (whole === 0 && rest === 0) return '0'
  return rest === 1 ? `${whole}½` : String(whole)
}

/**
 * Suma la semana.
 *
 * Solo entran las personas con algo marcado: mostrar en el detalle a alguien
 * en cero es ruido que estorba justo cuando se está revisando.
 */
export function estimateWeek(marked: readonly MarkedDays[]): WeekEstimate {
  const lines: EstimateLine[] = []
  const withoutRate: string[] = []
  let fullDays = 0
  let halfDays = 0
  let extra = ZERO
  let grand = ZERO

  for (const person of marked) {
    const nothing = person.fullDays === 0 && person.halfDays === 0 && person.extra === ZERO
    if (nothing) continue

    let subtotal: Cents | null = null
    if (person.rate !== null) {
      subtotal = add(
        // El medio día es exactamente 1/2, no 0.5 en coma flotante.
        multiplyRatio(person.rate, BigInt(person.fullDays), 1n),
        multiplyRatio(person.rate, BigInt(person.halfDays), 2n),
      )
      subtotal = add(subtotal, person.extra)
      grand = add(grand, subtotal)
    } else {
      withoutRate.push(person.name)
    }

    fullDays += person.fullDays
    halfDays += person.halfDays
    extra = add(extra, person.extra)

    lines.push({
      name: person.name,
      fullDays: person.fullDays,
      halfDays: person.halfDays,
      extra: person.extra,
      subtotal,
    })
  }

  lines.sort((a, b) => a.name.localeCompare(b.name, 'es'))

  return {
    lines,
    people: lines.length,
    fullDays,
    halfDays,
    daysLabel: daysLabel(fullDays, halfDays),
    extra,
    grand,
    withoutRate,
  }
}
