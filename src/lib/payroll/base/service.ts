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
}

/**
 * Los días capturados que cumplen el filtro, uno por renglón.
 *
 * `tope` sube para la descarga a Excel: ahí el archivo completo sí tiene
 * sentido porque nadie tiene que dibujarlo.
 */
export async function baseDeDatos(
  companyId: string,
  filtros: BaseFilters,
  tope: number = TOPE,
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
      weekLabel: e.payrollWeek.label,
      weekYear: e.payrollWeek.year,
      weekStart: toIso(e.payrollWeek.startDate),
      workDate: toIso(e.workDate),
      dayName: shortDay(toIso(e.workDate)),
      workerName: e.worker.displayName,
      workerId: e.worker.id,
      dayType: e.dayType,
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

  return { rows: filtrarBase(rows, filtros), truncado }
}
