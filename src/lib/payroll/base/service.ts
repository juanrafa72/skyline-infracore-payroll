import { prisma } from '@/lib/db/client'
import { shortDay, toIso } from '@/lib/payroll/week'
import { CON_TRABAJO_NUESTRO } from '@/lib/payroll/week-scope'
import { estadoDelDia, filtrarBase, type BaseFilters, type BaseRow } from './index'

/**
 * La base contra la base de datos.
 *
 * Las etiquetas y los filtros de texto viven en `./index.ts`, que es puro.
 */

/**
 * Un tope duro de filas EN PANTALLA.
 *
 * Skyline tiene 12.551 días capturados. Pintarlos todos de una vez tarda
 * segundos y no le sirve a nadie: la pantalla es para revisar una semana, no
 * para leer tres años de corrido. Con el filtro por semana casi nunca se llega
 * al tope, y cuando se llega la pantalla lo DICE en vez de recortar callada.
 *
 * Para llevarse todo está «Bajar a Excel», que no tiene este tope: ahí sí
 * tiene sentido el archivo completo, porque no hay que dibujarlo.
 */
export const TOPE = 800

/**
 * El tope de la descarga. Muy por encima de los 12.551 días de hoy: el
 * archivo se abre en Excel, que para eso está.
 */
export const TOPE_DESCARGA = 50_000

export interface WeekOption {
  id: string
  label: string
  year: number
  startDate: string
  /** Cuántos días capturados tiene. Ayuda a saber cuál mirar. */
  dias: number
  /** Solo tiene días del Excel: es archivo, no captura nuestra. */
  soloArchivo: boolean
}

/**
 * Las semanas para el selector, de la más reciente a la más vieja.
 *
 * El negocio lo pidió explícito: «que por defecto siempre salga la semana más
 * actual — lo primero que veo es week 33 y lo último week 1».
 */
export async function semanasDeLaBase(companyId: string): Promise<WeekOption[]> {
  const semanas = await prisma.payrollWeek.findMany({
    where: { companyId, workEntries: { some: {} } },
    orderBy: [{ startDate: 'desc' }],
    include: {
      _count: { select: { workEntries: true } },
    },
  })

  const propias = new Set(
    (
      await prisma.payrollWeek.findMany({
        where: { companyId, ...CON_TRABAJO_NUESTRO },
        select: { id: true },
      })
    ).map((w) => w.id),
  )

  return semanas.map((w) => ({
    id: w.id,
    label: w.label,
    year: w.year,
    startDate: toIso(w.startDate),
    dias: w._count.workEntries,
    soloArchivo: !propias.has(w.id),
  }))
}

/** Cuál semana mostrar cuando nadie ha escogido: la última con trabajo nuestro. */
export async function semanaPorDefecto(companyId: string): Promise<string | null> {
  const propia = await prisma.payrollWeek.findFirst({
    where: { companyId, ...CON_TRABAJO_NUESTRO },
    orderBy: { startDate: 'desc' },
    select: { id: true },
  })
  if (propia) return propia.id

  // Si no hay ninguna nuestra todavía, la más reciente con días.
  const cualquiera = await prisma.payrollWeek.findFirst({
    where: { companyId, workEntries: { some: {} } },
    orderBy: { startDate: 'desc' },
    select: { id: true },
  })
  return cualquiera?.id ?? null
}

export interface BaseResult {
  rows: BaseRow[]
  /** Se alcanzó el tope: hay más filas de las que se están mostrando. */
  truncado: boolean
  /** Existe una página siguiente. */
  hayMas?: boolean
  pagina?: number
}

/** Los días de las PERSONAS. */
async function diasDePersonas(
  companyId: string,
  filtros: BaseFilters,
  tope: number,
): Promise<BaseResult> {
  const where: Record<string, unknown> = { companyId }

  if (filtros.week && filtros.week !== 'todas') where.payrollWeekId = filtros.week
  if (filtros.worker) where.workerId = filtros.worker
  if (filtros.project) where.projectId = filtros.project
  // Los días del Excel son archivo: se ven solo si se piden.
  if (!filtros.incluirArchivo) where.sourceType = { not: 'IMPORT' }

  const entries = await prisma.workEntry.findMany({
    where,
    orderBy: [{ workDate: 'desc' }],
    take: tope + 1,
    include: {
      worker: { select: { id: true, displayName: true } },
      project: { select: { name: true } },
      crew: { select: { name: true } },
      payrollWeek: { select: { label: true, year: true, startDate: true } },
    },
  })

  const truncado = entries.length > tope
  const visibles = truncado ? entries.slice(0, tope) : entries

  /*
   * La tarifa que de verdad se aplicó.
   *
   * Sale de `PayrollLine`, donde quedó CONGELADA al calcular (BR-032). Si el
   * día todavía no se ha calculado no hay línea, y la columna queda vacía en
   * vez de mostrar la tarifa de hoy: una tarifa que cambió el mes pasado haría
   * creer que a esa persona se le pagó algo que nunca se le pagó.
   */
  const lineas = await prisma.payrollLine.findMany({
    where: { workEntryId: { in: visibles.map((e) => e.id) } },
    select: {
      workEntryId: true,
      appliedRate: true,
      amount: true,
      // En qué va la nómina de ese día: activo, pdt. aprobación, pdt. pago…
      workerPayroll: { select: { status: true } },
    },
  })
  const lineaPorDia = new Map(lineas.map((l) => [l.workEntryId!, l]))

  /*
   * El estado de los días TODAVÍA SIN CALCULAR.
   *
   * No tienen línea de nómina, pero su persona puede tener una nómina de esa
   * semana ya enviada o pagada — pasa con los días que se marcan «No trabajó»,
   * que no generan línea. Sin esto saldrían como «activo» cuando la semana ya
   * se pagó, y la Base diría que falta algo que ya salió del banco.
   */
  const nominas = await prisma.workerPayroll.findMany({
    where: {
      companyId,
      payrollWeekId: { in: [...new Set(visibles.map((e) => e.payrollWeekId))] },
      workerId: { in: [...new Set(visibles.map((e) => e.workerId))] },
    },
    select: { payrollWeekId: true, workerId: true, status: true },
  })
  const nominaPorPersonaSemana = new Map(
    nominas.map((n) => [`${n.payrollWeekId}:${n.workerId}`, n.status]),
  )

  const rows: BaseRow[] = visibles.map((e) => {
    const linea = lineaPorDia.get(e.id)
    return {
      id: e.id,
      tipo: 'PERSONA' as const,
      weekLabel: e.payrollWeek.label,
      weekYear: e.payrollWeek.year,
      weekStart: toIso(e.payrollWeek.startDate),
      workDate: toIso(e.workDate),
      dayName: shortDay(toIso(e.workDate)),
      workerName: e.worker.displayName,
      workerId: e.worker.id,
      dayType: e.dayType,
      detalle: null,
      payeeName: null,
      rate: linea ? linea.appliedRate.toFixed(2) : null,
      rateIsFrozen: linea !== undefined,
      amount: linea ? linea.amount.toFixed(2) : null,
      estado: estadoDelDia(
        linea?.workerPayroll?.status ??
          nominaPorPersonaSemana.get(`${e.payrollWeekId}:${e.workerId}`) ??
          null,
        e.sourceType === 'IMPORT',
      ),
      projectName: e.project?.name ?? null,
      crewName: e.crew?.name ?? null,
      isControlOnly: e.isControlOnly,
      fromImport: e.sourceType === 'IMPORT',
    }
  })

  return { rows, truncado }
}

/**
 * Los días de los EQUIPOS.
 *
 * Un equipo rentado que trabajó cinco días y cuyo proveedor cobró $2.250 no
 * aparecía en ninguna parte de la Base: la pantalla mentía por omisión. Cada
 * día marcado es un renglón, con el proveedor y el estado de su liquidación.
 */
async function diasDeEquipos(
  companyId: string,
  filtros: BaseFilters,
  tope: number,
): Promise<BaseResult> {
  const where: Record<string, unknown> = { companyId }
  if (filtros.week && filtros.week !== 'todas') where.payrollWeekId = filtros.week
  if (filtros.project) where.projectId = filtros.project

  const entries = await prisma.equipmentEntry.findMany({
    where,
    orderBy: [{ workDate: 'desc' }],
    take: tope + 1,
    include: {
      equipment: {
        select: { id: true, name: true, ownership: true, vendor: { select: { name: true } } },
      },
      project: { select: { name: true } },
      crew: { select: { name: true } },
      payrollWeek: { select: { label: true, year: true, startDate: true } },
    },
  })

  const truncado = entries.length > tope
  const visibles = truncado ? entries.slice(0, tope) : entries

  // La liquidación de cada equipo en su semana: de ahí salen el costo
  // congelado y el estado.
  const payrolls = await prisma.equipmentPayroll.findMany({
    where: {
      companyId,
      payrollWeekId: { in: [...new Set(visibles.map((e) => e.payrollWeekId))] },
      equipmentId: { in: [...new Set(visibles.map((e) => e.equipmentId))] },
    },
    select: {
      payrollWeekId: true,
      equipmentId: true,
      status: true,
      appliedDailyCost: true,
    },
  })
  const porEquipoSemana = new Map(
    payrolls.map((p) => [`${p.payrollWeekId}:${p.equipmentId}`, p]),
  )

  const rows: BaseRow[] = visibles.map((e) => {
    const liq = porEquipoSemana.get(`${e.payrollWeekId}:${e.equipmentId}`)
    const propio = e.equipment.ownership !== 'RENTED'
    return {
      id: e.id,
      tipo: 'EQUIPO' as const,
      weekLabel: e.payrollWeek.label,
      weekYear: e.payrollWeek.year,
      weekStart: toIso(e.payrollWeek.startDate),
      workDate: toIso(e.workDate),
      dayName: shortDay(toIso(e.workDate)),
      workerName: e.equipment.name,
      workerId: e.equipment.id,
      dayType: 'EN_OBRA',
      detalle: propio ? 'propio' : 'rentado',
      // Un equipo propio no le debe nada a nadie (A14): no tiene beneficiario.
      payeeName: propio ? null : (e.equipment.vendor?.name ?? null),
      rate: liq?.appliedDailyCost ? liq.appliedDailyCost.toFixed(2) : null,
      rateIsFrozen: liq !== undefined,
      // Lo que vale ESE día del equipo es su costo diario.
      amount: propio ? null : (liq?.appliedDailyCost?.toFixed(2) ?? null),
      estado: propio ? 'ARCHIVO' : estadoDelDia(liq?.status ?? null, false),
      projectName: e.project?.name ?? null,
      crewName: e.crew?.name ?? null,
      isControlOnly: false,
      fromImport: false,
    }
  })

  return { rows, truncado }
}

/**
 * Lo de las CUADRILLAS: su producción y, si cobran por día, sus días.
 *
 * Son dos formas de lo mismo —lo que se le debe al contratista esa semana— y
 * en la hoja conviven porque el negocio quiere ver todo junto.
 */
async function renglonesDeCuadrillas(
  companyId: string,
  filtros: BaseFilters,
  tope: number,
): Promise<BaseResult> {
  const whereProd: Record<string, unknown> = { companyId, crewId: { not: null } }
  const whereDias: Record<string, unknown> = { companyId }
  if (filtros.week && filtros.week !== 'todas') {
    whereProd.payrollWeekId = filtros.week
    whereDias.payrollWeekId = filtros.week
  }
  if (filtros.project) {
    whereProd.projectId = filtros.project
    whereDias.projectId = filtros.project
  }

  const [produccion, dias] = await Promise.all([
    prisma.production.findMany({
      where: whereProd,
      orderBy: [{ productionDate: 'desc' }],
      take: tope + 1,
      include: {
        crew: { select: { id: true, name: true } },
        project: { select: { name: true } },
        payrollWeek: { select: { label: true, year: true, startDate: true } },
      },
    }),
    prisma.crewDayEntry.findMany({
      where: whereDias,
      orderBy: [{ workDate: 'desc' }],
      take: tope + 1,
      include: {
        crew: { select: { id: true, name: true } },
        project: { select: { name: true } },
        payrollWeek: { select: { label: true, year: true, startDate: true } },
      },
    }),
  ])

  const semanas = [
    ...produccion.map((p) => p.payrollWeekId).filter((x): x is string => !!x),
    ...dias.map((d) => d.payrollWeekId),
  ]
  const crews = [...produccion.map((p) => p.crewId!), ...dias.map((d) => d.crewId)]

  const payrolls = await prisma.crewPayroll.findMany({
    where: {
      companyId,
      payrollWeekId: { in: [...new Set(semanas)] },
      crewId: { in: [...new Set(crews)] },
    },
    select: {
      payrollWeekId: true,
      crewId: true,
      status: true,
      contractorNameSnapshot: true,
      appliedDailyRate: true,
    },
  })
  const porCrewSemana = new Map(payrolls.map((p) => [`${p.payrollWeekId}:${p.crewId}`, p]))

  const rows: BaseRow[] = [
    ...produccion
      .filter((p) => p.payrollWeek !== null)
      .map((p) => {
        const liq = porCrewSemana.get(`${p.payrollWeekId}:${p.crewId}`)
        return {
          id: p.id,
          tipo: 'CUADRILLA' as const,
          weekLabel: p.payrollWeek!.label,
          weekYear: p.payrollWeek!.year,
          weekStart: toIso(p.payrollWeek!.startDate),
          workDate: toIso(p.productionDate),
          dayName: shortDay(toIso(p.productionDate)),
          workerName: p.crew?.name ?? 'Sin cuadrilla',
          workerId: p.crew?.id ?? p.id,
          dayType: 'PRODUCCION',
          detalle: `${Number(p.quantity).toLocaleString('en-US')} ${p.unitLabel}`,
          payeeName: liq?.contractorNameSnapshot ?? null,
          // El precio por unidad, congelado al registrar (BR-213).
          rate: p.appliedPrice.toString(),
          rateIsFrozen: true,
          amount: p.amount.toFixed(2),
          estado: estadoDelDia(liq?.status ?? null, false),
          projectName: p.project?.name ?? null,
          crewName: p.crew?.name ?? null,
          isControlOnly: false,
          fromImport: p.sourceType === 'IMPORT',
        }
      }),
    ...dias.map((d) => {
      const liq = porCrewSemana.get(`${d.payrollWeekId}:${d.crewId}`)
      return {
        id: d.id,
        tipo: 'CUADRILLA' as const,
        weekLabel: d.payrollWeek.label,
        weekYear: d.payrollWeek.year,
        weekStart: toIso(d.payrollWeek.startDate),
        workDate: toIso(d.workDate),
        dayName: shortDay(toIso(d.workDate)),
        workerName: d.crew.name,
        workerId: d.crew.id,
        dayType: 'DIA_CREW',
        detalle: 'precio fijo por día',
        payeeName: liq?.contractorNameSnapshot ?? null,
        rate: liq?.appliedDailyRate?.toFixed(2) ?? null,
        rateIsFrozen: liq !== undefined,
        amount: liq?.appliedDailyRate?.toFixed(2) ?? null,
        estado: estadoDelDia(liq?.status ?? null, false),
        projectName: d.project?.name ?? null,
        crewName: d.crew.name,
        isControlOnly: false,
        fromImport: false,
      }
    }),
  ]

  return {
    rows,
    truncado: produccion.length > tope || dias.length > tope,
  }
}

/**
 * TODO lo capturado en una sola hoja: personas, equipos y cuadrillas.
 *
 * El negocio lo pidió así —«ya que en la base está toda la información… uno
 * debería poder ver todo»— y en una sola tabla ordenada por fecha, no en
 * pestañas: es lo más parecido a la hoja de Excel de siempre.
 */
export async function baseDeDatos(
  companyId: string,
  filtros: BaseFilters,
  tope: number = TOPE,
  /** Página que se pide, empezando en 1. */
  pagina: number = 1,
): Promise<BaseResult> {
  /*
   * Cada fuente pide su propio tope.
   *
   * Si se pidiera `tope` a cada una y luego se mezclaran, las de más volumen
   * (las personas) taparían a las otras al recortar. Se traen completas hasta
   * el tope y el recorte se hace UNA vez, ya ordenado por fecha.
   */
  const soloUno = filtros.tipo

  /*
   * Para paginar hay que traer hasta el final de la página pedida.
   *
   * No se puede pedir «solo la página 3» a cada fuente por separado: al
   * mezclarlas por fecha, la página 3 del conjunto no es la página 3 de
   * ninguna. Se traen hasta donde alcanza y el corte se hace ya ordenado.
   */
  const hasta = tope * pagina

  const [personas, equipos, cuadrillas] = await Promise.all([
    !soloUno || soloUno === 'PERSONA'
      ? diasDePersonas(companyId, filtros, hasta)
      : { rows: [], truncado: false },
    !soloUno || soloUno === 'EQUIPO'
      ? diasDeEquipos(companyId, filtros, hasta)
      : { rows: [], truncado: false },
    !soloUno || soloUno === 'CUADRILLA'
      ? renglonesDeCuadrillas(companyId, filtros, hasta)
      : { rows: [], truncado: false },
  ])

  const todo = [...personas.rows, ...equipos.rows, ...cuadrillas.rows].sort((a, b) => {
    // Lo más reciente arriba; a igual fecha, primero las personas.
    if (a.workDate !== b.workDate) return a.workDate < b.workDate ? 1 : -1
    if (a.tipo !== b.tipo) return a.tipo.localeCompare(b.tipo)
    return a.workerName.localeCompare(b.workerName, 'es')
  })

  const filtradas = filtrarBase(todo, filtros)

  const desde = tope * (pagina - 1)
  const enEstaPagina = filtradas.slice(desde, desde + tope)

  return {
    rows: enEstaPagina,
    truncado: personas.truncado || equipos.truncado || cuadrillas.truncado,
    // Hay más adelante: en lo cargado o porque alguna fuente se quedó corta.
    hayMas:
      filtradas.length > desde + tope ||
      personas.truncado ||
      equipos.truncado ||
      cuadrillas.truncado,
    pagina,
  }
}
