/**
 * Lo que la rejilla de días dice sobre el PROYECTO de cada día.
 *
 * Dos formas de decirlo, y una manda sobre la otra:
 *
 *   `proyecto:<workerId>`               → toda la semana en ese proyecto
 *   `proyectodia:<workerId>:<fecha>`    → ese día en particular
 *
 * El día manda porque es lo más específico: la misma persona trabaja lunes,
 * martes y viernes en un pueblo y miércoles y jueves en otro. `WorkEntry`
 * siempre guardó el proyecto de cada día; esto es solo quién gana cuando el
 * formulario dice las dos cosas.
 *
 * Puro a propósito: de este dato sale el cliente al que se le factura el día,
 * así que la regla de precedencia se prueba sola, sin base de datos ni
 * pantalla.
 */

export interface ProjectSelection {
  /** Proyecto elegido para toda la semana. `null` = sin proyecto. */
  byWorker: ReadonlyMap<string, string | null>
  /** Proyecto elegido para un día. Clave: `workerId:fecha`. */
  byDay: ReadonlyMap<string, string | null>
}

export interface ProjectChoice {
  /**
   * El formulario dijo algo sobre este día.
   *
   * `false` no es "sin proyecto": es "no me preguntes". Un campo ausente jamás
   * debe borrar el proyecto que ya tenía el día guardado.
   */
  chose: boolean
  /** Proyecto elegido; `null` = sin proyecto, dicho a propósito. */
  projectId: string | null
}

const WEEK_PREFIX = 'proyecto:'
const DAY_PREFIX = 'proyectodia:'

/** Lee los campos de proyecto del formulario. Ignora todo lo demás. */
export function readProjectSelection(
  fields: Iterable<readonly [string, string]>,
): ProjectSelection {
  const byWorker = new Map<string, string | null>()
  const byDay = new Map<string, string | null>()

  for (const [key, raw] of fields) {
    const value = raw.trim()
    const chosen = value === '' ? null : value

    // El del día se revisa primero: `proyectodia:` también empieza por
    // «proyecto», y con el orden al revés todos caerían en el de la semana.
    if (key.startsWith(DAY_PREFIX)) {
      const [, workerId, date] = key.split(':')
      if (!workerId || !date) continue
      byDay.set(`${workerId}:${date}`, chosen)
      continue
    }

    if (key.startsWith(WEEK_PREFIX)) {
      const workerId = key.slice(WEEK_PREFIX.length)
      if (!workerId) continue
      byWorker.set(workerId, chosen)
    }
  }

  return { byWorker, byDay }
}

/** Qué proyecto le toca a un día: primero el suyo, luego el de la semana. */
export function projectForDay(
  selection: ProjectSelection,
  workerId: string,
  date: string,
): ProjectChoice {
  const dayKey = `${workerId}:${date}`
  if (selection.byDay.has(dayKey)) {
    return { chose: true, projectId: selection.byDay.get(dayKey) ?? null }
  }
  if (selection.byWorker.has(workerId)) {
    return { chose: true, projectId: selection.byWorker.get(workerId) ?? null }
  }
  return { chose: false, projectId: null }
}
