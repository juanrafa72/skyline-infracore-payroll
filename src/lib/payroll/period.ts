/**
 * Períodos de pago.
 *
 * El negocio paga con distintas frecuencias y además necesita hacer **cortes**
 * fuera de calendario: cuando alguien se retira hay que liquidarle todo lo
 * pendiente ese mismo día, sin esperar al cierre normal.
 *
 * Todas las fechas se manejan en UTC y como texto `YYYY-MM-DD`, para que no
 * cambien según la zona horaria del computador de quien las mire.
 */
import { toIso, weekNumberOf, weekRangeOf } from './week'

export type PayPeriodType = 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY'

export const PAY_PERIOD_LABELS: Record<PayPeriodType, string> = {
  DAILY: 'Diario',
  WEEKLY: 'Semanal',
  BIWEEKLY: 'Catorcenal (cada 14 días)',
  SEMI_MONTHLY: 'Quincenal (1–15 y 16–fin de mes)',
  MONTHLY: 'Mensual',
}

export interface PayPeriod {
  periodType: PayPeriodType
  year: number
  /** Número consecutivo dentro del año. Para WEEKLY coincide con el de Excel. */
  periodNumber: number
  startDate: string
  endDate: string
  label: string
  days: readonly string[]
}

function utc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`)
}

function addDays(isoDate: string, amount: number): string {
  const date = utc(isoDate)
  date.setUTCDate(date.getUTCDate() + amount)
  return toIso(date)
}

function daysBetween(from: string, to: string): readonly string[] {
  const days: string[] = []
  let cursor = from
  while (cursor <= to) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return days
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const

/**
 * Período que contiene la fecha dada.
 *
 * `biweeklyAnchor` es el primer día del primer período catorcenal del año.
 * Es configurable porque el ciclo de 14 días no se deduce del calendario:
 * depende de cuándo arrancó el negocio a pagar así.
 */
export function periodOf(
  isoDate: string,
  periodType: PayPeriodType,
  options: { biweeklyAnchor?: string } = {},
): PayPeriod {
  const date = utc(isoDate)
  const year = date.getUTCFullYear()
  const monthIndex = date.getUTCMonth()
  const dayOfMonth = date.getUTCDate()

  switch (periodType) {
    case 'DAILY':
      return build('DAILY', year, dayOfYear(date) + 1, isoDate, isoDate, formatDay(isoDate))

    case 'WEEKLY': {
      const week = weekRangeOf(isoDate)
      return build('WEEKLY', week.year, week.weekNumber, week.startDate, week.endDate, week.label)
    }

    case 'BIWEEKLY': {
      const anchor = options.biweeklyAnchor ?? `${year}-01-01`
      const elapsed = Math.floor((utc(isoDate).getTime() - utc(anchor).getTime()) / 86_400_000)
      const index = Math.floor(elapsed / 14)
      const start = addDays(anchor, index * 14)
      const end = addDays(start, 13)
      return build('BIWEEKLY', year, index + 1, start, end, `Catorcena ${index + 1}`)
    }

    case 'SEMI_MONTHLY': {
      const firstHalf = dayOfMonth <= 15
      const start = `${year}-${pad(monthIndex + 1)}-${firstHalf ? '01' : '16'}`
      const end = firstHalf
        ? `${year}-${pad(monthIndex + 1)}-15`
        : `${year}-${pad(monthIndex + 1)}-${pad(lastDayOfMonth(year, monthIndex))}`
      const number = monthIndex * 2 + (firstHalf ? 1 : 2)
      const label = `${firstHalf ? '1ª' : '2ª'} quincena de ${MONTHS[monthIndex]}`
      return build('SEMI_MONTHLY', year, number, start, end, label)
    }

    case 'MONTHLY': {
      const start = `${year}-${pad(monthIndex + 1)}-01`
      const end = `${year}-${pad(monthIndex + 1)}-${pad(lastDayOfMonth(year, monthIndex))}`
      return build('MONTHLY', year, monthIndex + 1, start, end, `${capitalize(MONTHS[monthIndex]!)}`)
    }
  }
}

/**
 * Corte fuera de calendario: liquidación de un rango arbitrario.
 *
 * Se usa cuando alguien se retira y hay que pagarle todo lo pendiente sin
 * esperar el cierre normal. No pertenece a ningún ciclo: se identifica por sus
 * propias fechas y queda marcado como corte para que nadie lo confunda con un
 * período regular ni lo cuente dos veces.
 */
export function offCyclePeriod(startDate: string, endDate: string): PayPeriod {
  if (endDate < startDate) {
    throw new RangeError('La fecha final del corte no puede ser anterior a la inicial')
  }
  const year = utc(endDate).getUTCFullYear()
  return {
    periodType: 'DAILY',
    year,
    // Número derivado de la fecha final, para que no choque con los regulares.
    periodNumber: 900 + weekNumberOf(endDate),
    startDate,
    endDate,
    label: `Corte ${formatDay(startDate)} – ${formatDay(endDate)}`,
    days: daysBetween(startDate, endDate),
  }
}

function build(
  periodType: PayPeriodType,
  year: number,
  periodNumber: number,
  startDate: string,
  endDate: string,
  label: string,
): PayPeriod {
  return { periodType, year, periodNumber, startDate, endDate, label, days: daysBetween(startDate, endDate) }
}

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

function dayOfYear(date: Date): number {
  return Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000)
}

function formatDay(isoDate: string): string {
  const date = utc(isoDate)
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]!.slice(0, 3)} ${date.getUTCFullYear()}`
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
