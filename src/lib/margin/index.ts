/**
 * Margen: venta menos costo.
 *
 *     venta (lo que el cliente nos paga)
 *   − costo (lo que le pagamos a la gente)
 *   = margen bruto
 *
 * Puro y en centavos enteros. Es la cifra con la que se decide si un proyecto
 * o una cuadrilla dan plata; calcularla en coma flotante o redondear a mitad
 * de camino la vuelve una opinión.
 *
 * **El costo es el BRUTO, no el neto.** Descontarle a alguien un préstamo no
 * abarata la mano de obra: solo recupera dinero que ya se había entregado. Si
 * se usara el neto, prestarle plata a un trabajador haría "subir" el margen,
 * que es exactamente al revés de la realidad — BR-202.
 */
import {
  type Cents,
  ZERO,
  add,
  isZero,
  subtract,
  toDecimalString,
} from '@/lib/payroll/engine/money'

export interface MarginDay {
  date: string
  /** Lo que se le cobra al cliente por este día. `null` = no se sabe. */
  revenue: Cents | null
  /** Lo que nos cuesta este día. Siempre se sabe: sin costo no hay línea. */
  cost: Cents
}

export interface Margin {
  revenue: Cents
  cost: Cents
  margin: Cents
  /**
   * Margen porcentual sobre la venta, con 2 decimales, como cadena.
   * `null` cuando la venta es cero o incompleta: dividir por cero no es 0%,
   * es una pregunta sin respuesta.
   */
  marginPct: string | null
  /** Días que no tienen tarifa de venta. Si es > 0, la venta está incompleta. */
  daysWithoutRevenue: number
  /** `true` solo si TODOS los días tienen venta conocida. */
  complete: boolean
}

/**
 * Suma venta, costo y margen de un conjunto de días.
 *
 * Los días sin venta conocida se cuentan aparte y NO se toman como cero: un
 * margen calculado sobre información incompleta tiene que decirlo, porque
 * quien lo lea va a tomar decisiones con él.
 */
export function computeMargin(days: readonly MarginDay[]): Margin {
  let revenue = ZERO
  let cost = ZERO
  let daysWithoutRevenue = 0

  for (const day of days) {
    cost = add(cost, day.cost)
    if (day.revenue === null) daysWithoutRevenue += 1
    else revenue = add(revenue, day.revenue)
  }

  const margin = subtract(revenue, cost)

  return {
    revenue,
    cost,
    margin,
    marginPct: marginPercentage(revenue, margin, daysWithoutRevenue === 0),
    daysWithoutRevenue,
    complete: daysWithoutRevenue === 0,
  }
}

/**
 * Margen porcentual sobre la venta.
 *
 * Se calcula en enteros y se redondea UNA sola vez, al final. `null` cuando no
 * se puede responder: sin venta, o con la venta incompleta.
 */
export function marginPercentage(
  revenue: Cents,
  margin: Cents,
  complete = true,
): string | null {
  if (!complete) return null
  if (isZero(revenue)) return null

  // × 10000 para conservar dos decimales antes de dividir.
  const scaled = (margin * 1000000n) / revenue
  const rounded = (scaled + (scaled < 0n ? -50n : 50n)) / 100n
  const sign = rounded < 0n ? '-' : ''
  const absolute = rounded < 0n ? -rounded : rounded
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}

/** Suma varios márgenes ya calculados — por cuadrilla, proyecto, semana. */
export function sumMargins(parts: readonly Margin[]): Margin {
  let revenue = ZERO
  let cost = ZERO
  let daysWithoutRevenue = 0

  for (const part of parts) {
    revenue = add(revenue, part.revenue)
    cost = add(cost, part.cost)
    daysWithoutRevenue += part.daysWithoutRevenue
  }

  const margin = subtract(revenue, cost)
  const complete = daysWithoutRevenue === 0

  return {
    revenue,
    cost,
    margin,
    marginPct: marginPercentage(revenue, margin, complete),
    daysWithoutRevenue,
    complete,
  }
}

/** Cómo se muestra un margen en pantalla, ya en texto. */
export interface MarginView {
  revenue: string
  cost: string
  margin: string
  marginPct: string | null
  complete: boolean
  daysWithoutRevenue: number
  /** Aviso en español cuando la venta está incompleta, o `null`. */
  warning: string | null
}

export function toView(margin: Margin): MarginView {
  return {
    revenue: toDecimalString(margin.revenue),
    cost: toDecimalString(margin.cost),
    margin: toDecimalString(margin.margin),
    marginPct: margin.marginPct,
    complete: margin.complete,
    daysWithoutRevenue: margin.daysWithoutRevenue,
    warning: margin.complete
      ? null
      : `${margin.daysWithoutRevenue} día(s) sin tarifa de venta. La venta y el margen ` +
        'que se muestran están incompletos: falta configurar cuánto se le cobra al cliente.',
  }
}

export const EMPTY_MARGIN: Margin = {
  revenue: ZERO,
  cost: ZERO,
  margin: ZERO,
  marginPct: null,
  daysWithoutRevenue: 0,
  complete: true,
}
