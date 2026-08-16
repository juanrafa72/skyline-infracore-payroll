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

/**
 * Cómo se lee cada tipo de día en la tabla. Corto: la columna es angosta.
 *
 * Los cinco primeros son de personas. Los tres últimos existen porque en la
 * misma hoja conviven equipos y cuadrillas, y «Sí» no significa nada para una
 * máquina: lo que dice es que ESTUVO en obra.
 */
export const DIA_ETIQUETA: Record<string, string> = {
  FULL_DAY: 'Sí',
  HALF_DAY: 'Medio',
  NO_WORK: 'No',
  HOURLY: 'Por horas',
  PLUS: 'Sí + extra',
  EN_OBRA: 'En obra',
  PRODUCCION: 'Produjo',
  DIA_CREW: 'Trabajó',
}

/** Cuántos días paga cada tipo. Sirve para el total de la vista. */
export function diasQuePaga(dayType: string): number {
  if (dayType === 'FULL_DAY' || dayType === 'PLUS') return 1
  if (dayType === 'HALF_DAY') return 0.5
  return 0
}

/**
 * En qué va ese día dentro del proceso.
 *
 * El negocio lo pidió con estas palabras exactas: marcado = «activo», enviado
 * = «pendiente por aprobación», aprobado = «pendiente por pago», y cuando el
 * dinero salió = «pagada». Es el mismo estado de la nómina, dicho como se
 * habla en la oficina en vez de con los nombres del sistema.
 */
export type EstadoBase =
  | 'ACTIVO'
  | 'PDT_APROBACION'
  | 'PDT_PAGO'
  | 'PAGADA'
  | 'DEVUELTA'
  | 'ARCHIVO'

export const ESTADO_BASE: Record<EstadoBase, string> = {
  ACTIVO: 'Activo',
  PDT_APROBACION: 'Pdt. por aprobación',
  PDT_PAGO: 'Pdt. por pago',
  PAGADA: 'Pagada',
  DEVUELTA: 'Devuelta',
  ARCHIVO: 'Archivo del Excel',
}

/** El color de cada estado: lo pagado en verde, lo pendiente en ámbar. */
export const TONO_ESTADO: Record<EstadoBase, 'good' | 'warning' | 'info' | 'neutral'> = {
  ACTIVO: 'info',
  PDT_APROBACION: 'warning',
  PDT_PAGO: 'warning',
  PAGADA: 'good',
  DEVUELTA: 'warning',
  ARCHIVO: 'neutral',
}

/**
 * Traduce el estado de la nómina al que se muestra en la Base.
 *
 * Un día del Excel no tiene nómina y nunca la va a tener (BR-153): decir
 * «activo» ahí invitaría a calcular algo que ya se pagó por fuera.
 */
export function estadoDelDia(
  estadoNomina: string | null,
  fromImport: boolean,
): EstadoBase {
  if (fromImport) return 'ARCHIVO'
  if (!estadoNomina) return 'ACTIVO'

  switch (estadoNomina) {
    case 'DRAFT':
    case 'PREPARED':
      // Calculada pero todavía en la mesa de quien prepara: sigue siendo suya.
      return 'ACTIVO'
    case 'PENDING_APPROVAL':
      return 'PDT_APROBACION'
    case 'REJECTED':
      // Volvió con comentarios: hay que corregirla, no está esperando a nadie.
      return 'DEVUELTA'
    case 'APPROVED':
    case 'READY_TO_PAY':
    case 'PAYMENT_IN_PROCESS':
      // Aprobada y esperando que tesorería transfiera.
      return 'PDT_PAGO'
    case 'PAID':
    case 'RECONCILED':
    case 'CLOSED':
      return 'PAGADA'
    default:
      return 'ACTIVO'
  }
}

/**
 * Qué se está pagando en ese renglón.
 *
 * El negocio pidió ver TODO en una sola hoja: la Base solo mostraba días de
 * personas, y un equipo rentado que trabajó cinco días no aparecía en ninguna
 * parte. Mentía por omisión.
 */
export type TipoRenglon = 'PERSONA' | 'EQUIPO' | 'CUADRILLA'

export const TIPO_ETIQUETA: Record<TipoRenglon, string> = {
  PERSONA: 'Persona',
  EQUIPO: 'Equipo',
  CUADRILLA: 'Cuadrilla',
}

export interface BaseRow {
  id: string
  /** Persona, equipo o cuadrilla. */
  tipo: TipoRenglon
  weekLabel: string
  weekYear: number
  /** Para ordenar: la semana más reciente primero. */
  weekStart: string
  workDate: string
  /** dom, lun, mar… */
  dayName: string
  /** El nombre de quien sea: la persona, el equipo o la cuadrilla. */
  workerName: string
  workerId: string
  /**
   * Qué pasó ese día. Para una persona es el tipo de jornada; para un equipo,
   * que estuvo en obra; para una cuadrilla, la producción o el día trabajado.
   */
  dayType: string
  /** Detalle de la cuadrilla: «10.000 pies». Vacío en los otros. */
  detalle: string | null
  /** A quién se le paga: el proveedor del equipo o el contratista del crew. */
  payeeName: string | null
  /** La tarifa CONGELADA del día si ya se calculó; si no, la vigente hoy. */
  rate: string | null
  /** `true` cuando la tarifa sale del cálculo y no de una estimación. */
  rateIsFrozen: boolean
  /**
   * Lo que vale ESE día: tarifa × jornada. Un día completo a $190 son $190;
   * medio día, $95. No es lo que salió del banco — para eso está `estado`.
   */
  amount: string | null
  /** En qué va ese día: activo, pdt. por aprobación, pdt. por pago, pagada. */
  estado: EstadoBase
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
  /** PERSONA · EQUIPO · CUADRILLA, o todos. */
  tipo?: string | null
  worker?: string | null
  project?: string | null
  dayType?: string | null
  /** Activo, pendiente por aprobación, pendiente por pago, pagada… */
  estado?: string | null
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
    if (filtros.tipo && fila.tipo !== filtros.tipo) return false
    if (filtros.dayType && fila.dayType !== filtros.dayType) return false
    if (filtros.estado && fila.estado !== filtros.estado) return false
    if (filtros.q) {
      const texto = filtros.q.toLowerCase()
      const enAlgo =
        fila.workerName.toLowerCase().includes(texto) ||
        (fila.projectName ?? '').toLowerCase().includes(texto) ||
        (fila.crewName ?? '').toLowerCase().includes(texto) ||
        (fila.payeeName ?? '').toLowerCase().includes(texto)
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
    'Qué',
    'Nombre',
    'Trabajó',
    'Detalle',
    'Tarifa',
    'Vale el día',
    'Estado',
    'Se le paga a',
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
      TIPO_ETIQUETA[f.tipo],
      f.workerName,
      DIA_ETIQUETA[f.dayType] ?? f.dayType,
      f.detalle ?? '',
      f.rate ?? '',
      f.amount ?? '',
      ESTADO_BASE[f.estado],
      f.payeeName ?? '',
      f.projectName ?? '',
      f.crewName ?? '',
      f.fromImport ? 'Excel' : f.isControlOnly ? 'Control' : 'Capturado',
    ]
      .map(escapar)
      .join(','),
  )

  return [cabecera.map(escapar).join(','), ...lineas].join('\n')
}
