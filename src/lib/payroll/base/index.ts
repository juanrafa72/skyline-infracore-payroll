/**
 * La BASE: un renglón por día trabajado, como la hoja de Excel de siempre.
 *
 * El negocio la pidió para revisar lo capturado en semanas anteriores sin
 * tener que abrir semana por semana: semana, persona, día, si trabajó, tarifa
 * y proyecto, con filtros.
 *
 * Aquí van las etiquetas y los filtros, que son puros. Las consultas viven en
 * `./service.ts`.
 */

export type DayType = 'FULL_DAY' | 'HALF_DAY' | 'NO_WORK' | 'HOURLY' | 'PLUS'

/** Cómo se lee cada tipo de día en la tabla. Corto: la columna es angosta. */
export const DIA_ETIQUETA: Record<string, string> = {
  FULL_DAY: 'Sí',
  HALF_DAY: 'Medio',
  NO_WORK: 'No',
  HOURLY: 'Por horas',
  PLUS: 'Sí + extra',
}

/** Cuántos días paga cada tipo. Sirve para el total de la vista. */
export function diasQuePaga(dayType: string): number {
  if (dayType === 'FULL_DAY' || dayType === 'PLUS') return 1
  if (dayType === 'HALF_DAY') return 0.5
  return 0
}

export interface BaseRow {
  id: string
  weekLabel: string
  weekYear: number
  /** Para ordenar: la semana más reciente primero. */
  weekStart: string
  workDate: string
  /** dom, lun, mar… */
  dayName: string
  workerName: string
  workerId: string
  dayType: string
  /** La tarifa CONGELADA del día si ya se calculó; si no, la vigente hoy. */
  rate: string | null
  /** `true` cuando la tarifa sale del cálculo y no de una estimación. */
  rateIsFrozen: boolean
  /** Lo que se pagó por ese día, si ya se calculó. */
  amount: string | null
  projectName: string | null
  crewName: string | null
  /** Los días de control anotan pero NO pagan (BR-243). */
  isControlOnly: boolean
  /** Vino del Excel: es archivo, no captura nuestra. */
  fromImport: boolean
}

export interface BaseFilters {
  /** Vacío = la semana más reciente con trabajo. `todas` = sin filtro. */
  week?: string | null
  worker?: string | null
  project?: string | null
  dayType?: string | null
  /** Busca por nombre de persona o de proyecto. */
  q?: string | null
  /** Incluir los días que vinieron del Excel. Por defecto no. */
  incluirArchivo?: boolean
}

/**
 * Aplica los filtros que no conviene hacer en la consulta.
 *
 * El texto libre busca en varios campos a la vez y el tipo de día es un
 * puñado de valores: resolverlo aquí evita repetir la misma condición en SQL
 * y en la pantalla, que es como terminan diciendo cosas distintas.
 */
export function filtrarBase(filas: readonly BaseRow[], filtros: BaseFilters): BaseRow[] {
  return filas.filter((fila) => {
    if (filtros.dayType && fila.dayType !== filtros.dayType) return false
    if (filtros.q) {
      const texto = filtros.q.toLowerCase()
      const enAlgo =
        fila.workerName.toLowerCase().includes(texto) ||
        (fila.projectName ?? '').toLowerCase().includes(texto) ||
        (fila.crewName ?? '').toLowerCase().includes(texto)
      if (!enAlgo) return false
    }
    return true
  })
}

export interface BaseTotals {
  registros: number
  /** Días que pagan: completo = 1, medio = 0.5. */
  diasPagados: string
  /** Cuántos días se marcaron como "no trabajó". */
  diasNoTrabajo: number
  personas: number
  proyectos: number
}

/** El resumen de lo que se está viendo, con los filtros puestos. */
export function totalizarBase(filas: readonly BaseRow[]): BaseTotals {
  let diasPagados = 0
  let diasNoTrabajo = 0
  const personas = new Set<string>()
  const proyectos = new Set<string>()

  for (const fila of filas) {
    // Un día de control anota pero no paga: sumarlo inflaría el conteo.
    if (!fila.isControlOnly) diasPagados += diasQuePaga(fila.dayType)
    if (fila.dayType === 'NO_WORK') diasNoTrabajo += 1
    personas.add(fila.workerId)
    if (fila.projectName) proyectos.add(fila.projectName)
  }

  return {
    registros: filas.length,
    // Media jornada existe: 12.5 días es una cifra real, no un error.
    diasPagados: diasPagados % 1 === 0 ? String(diasPagados) : diasPagados.toFixed(1),
    diasNoTrabajo,
    personas: personas.size,
    proyectos: proyectos.size,
  }
}

/** Los renglones como CSV, para abrirlos en Excel de verdad. */
export function aCsv(filas: readonly BaseRow[]): string {
  const cabecera = [
    'Semana',
    'Año',
    'Fecha',
    'Día',
    'Trabajador',
    'Trabajó',
    'Tarifa',
    'Se pagó',
    'Proyecto',
    'Cuadrilla',
    'Origen',
  ]

  // Comillas dobles y separador: un nombre con coma parte la fila si no se
  // escapa, y «Martinez, Angela» existe en los datos.
  const escapar = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`

  const lineas = filas.map((f) =>
    [
      f.weekLabel,
      String(f.weekYear),
      f.workDate,
      f.dayName,
      f.workerName,
      DIA_ETIQUETA[f.dayType] ?? f.dayType,
      f.rate ?? '',
      f.amount ?? '',
      f.projectName ?? '',
      f.crewName ?? '',
      f.fromImport ? 'Excel' : f.isControlOnly ? 'Control' : 'Capturado',
    ]
      .map(escapar)
      .join(','),
  )

  return [cabecera.map(escapar).join(','), ...lineas].join('\n')
}
