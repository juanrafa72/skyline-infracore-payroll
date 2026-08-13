/**
 * Rangos de tiempo del dashboard.
 *
 * Cada rango trae su período anterior comparable, del mismo largo, para poder
 * decir "subió 12 % contra la semana pasada" sin comparar peras con manzanas.
 */
import { toIso, weekRangeOf } from './week'

export type RangeKey = 'semana' | 'semana-anterior' | 'cuatro-semanas' | 'mes' | 'trimestre' | 'ano'

export const RANGE_LABELS: Record<RangeKey, string> = {
  semana: 'Esta semana',
  'semana-anterior': 'Semana pasada',
  'cuatro-semanas': 'Últimas 4 semanas',
  mes: 'Este mes',
  trimestre: 'Últimos 3 meses',
  ano: 'Este año',
}

export interface Range {
  key: RangeKey
  label: string
  from: string
  to: string
  /** Mismo largo, inmediatamente anterior. */
  previousFrom: string
  previousTo: string
  comparisonLabel: string
}

function shift(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return toIso(date)
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  )
}

export function resolveRange(key: RangeKey, today: string): Range {
  const thisWeek = weekRangeOf(today)
  let from: string
  let to: string
  let comparisonLabel: string

  switch (key) {
    case 'semana':
      from = thisWeek.startDate
      to = thisWeek.endDate
      comparisonLabel = 'vs semana pasada'
      break
    case 'semana-anterior': {
      const previous = weekRangeOf(shift(thisWeek.startDate, -1))
      from = previous.startDate
      to = previous.endDate
      comparisonLabel = 'vs la semana previa'
      break
    }
    case 'cuatro-semanas':
      from = shift(thisWeek.startDate, -21)
      to = thisWeek.endDate
      comparisonLabel = 'vs las 4 anteriores'
      break
    case 'mes': {
      const date = new Date(`${today}T00:00:00Z`)
      from = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`
      to = today
      comparisonLabel = 'vs mes anterior'
      break
    }
    case 'trimestre':
      from = shift(today, -89)
      to = today
      comparisonLabel = 'vs los 3 meses previos'
      break
    case 'ano': {
      const year = new Date(`${today}T00:00:00Z`).getUTCFullYear()
      from = `${year}-01-01`
      to = today
      comparisonLabel = 'vs el año pasado'
      break
    }
  }

  const length = daysBetween(from, to) + 1
  return {
    key,
    label: RANGE_LABELS[key],
    from,
    to,
    previousFrom: shift(from, -length),
    previousTo: shift(from, -1),
    comparisonLabel,
  }
}

/** Variación porcentual. `null` cuando no hay base con qué comparar. */
export function change(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}
