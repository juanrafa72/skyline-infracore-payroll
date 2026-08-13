/**
 * Semanas de nómina — BR-010, BR-011, BR-012.
 *
 * La semana va de domingo a sábado y se numera igual que `WEEKNUM` de Excel
 * (sistema US: la semana 1 es la que contiene el 1 de enero). Así los números
 * de semana del sistema coinciden con los que el equipo ya usa en los Excel.
 *
 * Todas las fechas se manejan en UTC y como texto `YYYY-MM-DD` para que no
 * dependan de la zona horaria del computador de quien las mire.
 */

export interface WeekRange {
  year: number
  weekNumber: number
  startDate: string // domingo
  endDate: string // sábado
  label: string
  days: readonly string[]
}

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const

export function dayName(isoDate: string): string {
  return DAY_NAMES[new Date(`${isoDate}T00:00:00Z`).getUTCDay()]!
}

export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function dayOfYear(date: Date): number {
  const jan1 = Date.UTC(date.getUTCFullYear(), 0, 1)
  return Math.floor((date.getTime() - jan1) / 86_400_000)
}

/** Número de semana equivalente a `WEEKNUM(fecha)` de Excel. */
export function weekNumberOf(isoDate: string): number {
  const date = new Date(`${isoDate}T00:00:00Z`)
  const jan1Dow = new Date(Date.UTC(date.getUTCFullYear(), 0, 1)).getUTCDay()
  return Math.floor((dayOfYear(date) + jan1Dow) / 7) + 1
}

/** Domingo de la semana que contiene la fecha. */
export function weekStartOf(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - date.getUTCDay())
  return toIso(date)
}

export function weekRangeOf(isoDate: string): WeekRange {
  const startDate = weekStartOf(isoDate)
  const start = new Date(`${startDate}T00:00:00Z`)

  const days: string[] = []
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(start)
    day.setUTCDate(start.getUTCDate() + offset)
    days.push(toIso(day))
  }

  // El año y el número de semana se toman de la fecha original, no del domingo:
  // una semana a caballo entre dos años pertenece al año de la fecha consultada.
  const reference = new Date(`${isoDate}T00:00:00Z`)
  const weekNumber = weekNumberOf(isoDate)

  return {
    year: reference.getUTCFullYear(),
    weekNumber,
    startDate,
    endDate: days[6]!,
    label: `Semana ${weekNumber}`,
    days,
  }
}

/** Formato corto para encabezados de la rejilla: "dom 19". */
export function shortDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  return `${DAY_NAMES[date.getUTCDay()]!.slice(0, 3)} ${date.getUTCDate()}`
}
