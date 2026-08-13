import { prisma } from '@/lib/db/client'
import type { Range } from './ranges'

/**
 * Consultas del dashboard.
 *
 * Se separan a propósito dos familias de indicadores:
 *
 *  - ACTIVIDAD (días, personas, operaciones): sale de `work_entry`, que tiene
 *    años de historia importada del Excel.
 *  - DINERO (bruto, descuentos, neto): sale de `worker_payroll`, que solo existe
 *    donde alguien ya calculó la nómina.
 *
 * No se estima dinero a partir de días × tarifa: sería inventar cifras que
 * nadie aprobó. Donde no hay nómina calculada, el dashboard lo dice.
 */

function utc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`)
}

export interface Activity {
  days: number
  fullDays: number
  halfDays: number
  noWorkDays: number
  people: number
}

export async function activityIn(companyId: string, from: string, to: string): Promise<Activity> {
  const where = { companyId, workDate: { gte: utc(from), lte: utc(to) } }

  const [byType, people] = await Promise.all([
    prisma.workEntry.groupBy({ by: ['dayType'], where, _count: { _all: true } }),
    prisma.workEntry.findMany({ where, select: { workerId: true }, distinct: ['workerId'] }),
  ])

  const count = (type: string) =>
    byType.find((row) => row.dayType === type)?._count._all ?? 0

  const fullDays = count('FULL_DAY') + count('HOURLY')
  const halfDays = count('HALF_DAY')

  return {
    days: fullDays + halfDays,
    fullDays,
    halfDays,
    noWorkDays: count('NO_WORK'),
    people: people.length,
  }
}

export interface Money {
  gross: number
  deductions: number
  net: number
  payrolls: number
}

export async function moneyIn(companyId: string, from: string, to: string): Promise<Money> {
  const result = await prisma.workerPayroll.aggregate({
    where: {
      companyId,
      payrollWeek: { startDate: { gte: utc(from) }, endDate: { lte: utc(to) } },
    },
    _sum: { grossPay: true, deductionsTotal: true, netPay: true },
    _count: { _all: true },
  })

  return {
    gross: Number(result._sum.grossPay ?? 0),
    deductions: Number(result._sum.deductionsTotal ?? 0),
    net: Number(result._sum.netPay ?? 0),
    payrolls: result._count._all,
  }
}

/**
 * Días que caen en períodos con nómina ya calculada.
 *
 * Es el único denominador honesto para "costo por día": dividir el dinero de
 * una semana entre los días de tres meses da una cifra sin sentido.
 */
export async function daysWithPayroll(
  companyId: string,
  from: string,
  to: string,
): Promise<number> {
  return prisma.workEntry.count({
    where: {
      companyId,
      workDate: { gte: utc(from), lte: utc(to) },
      dayType: { in: ['FULL_DAY', 'HALF_DAY', 'HOURLY'] },
      payrollWeek: { payrolls: { some: {} } },
    },
  })
}

export interface Breakdown {
  id: string | null
  label: string
  days: number
  people: number
  share: number
}

/**
 * Reparto de días por operación, proyecto o cuadrilla.
 *
 * Se traen las filas y se agrupan en memoria en vez de usar `groupBy` con un
 * campo dinámico: así el compilador sigue verificando los tipos. El volumen es
 * pequeño (una semana son cientos de filas; un año, unos miles).
 */
async function breakdownBy(
  companyId: string,
  range: Range,
  pick: (entry: EntryKeys) => string | null,
  names: Map<string, string>,
  unassignedLabel: string,
): Promise<Breakdown[]> {
  const entries = await prisma.workEntry.findMany({
    where: {
      companyId,
      workDate: { gte: utc(range.from), lte: utc(range.to) },
      dayType: { in: ['FULL_DAY', 'HALF_DAY', 'HOURLY'] },
    },
    select: { operationId: true, projectId: true, crewId: true, workerId: true },
  })

  const days = new Map<string, number>()
  const people = new Map<string, Set<string>>()

  for (const entry of entries) {
    const key = pick(entry) ?? ''
    days.set(key, (days.get(key) ?? 0) + 1)
    if (!people.has(key)) people.set(key, new Set())
    people.get(key)!.add(entry.workerId)
  }

  const total = entries.length || 1

  return [...days.entries()]
    .map(([key, count]) => ({
      id: key || null,
      label: key ? (names.get(key) ?? '—') : unassignedLabel,
      days: count,
      people: people.get(key)?.size ?? 0,
      share: (count / total) * 100,
    }))
    .sort((a, b) => b.days - a.days)
}

interface EntryKeys {
  operationId: string | null
  projectId: string | null
  crewId: string | null
}

export async function byOperation(companyId: string, range: Range): Promise<Breakdown[]> {
  const operations = await prisma.operation.findMany({ where: { companyId } })
  return breakdownBy(
    companyId,
    range,
    (entry) => entry.operationId,
    new Map(operations.map((operation) => [operation.id, operation.name])),
    'Sin unidad asignada',
  )
}

export async function byProject(companyId: string, range: Range): Promise<Breakdown[]> {
  const projects = await prisma.project.findMany({ where: { companyId } })
  return breakdownBy(
    companyId,
    range,
    (entry) => entry.projectId,
    new Map(projects.map((project) => [project.id, project.name])),
    'Sin proyecto',
  )
}

export async function byCrew(companyId: string, range: Range): Promise<Breakdown[]> {
  const crews = await prisma.crew.findMany({ where: { companyId } })
  return breakdownBy(
    companyId,
    range,
    (entry) => entry.crewId,
    new Map(crews.map((crew) => [crew.id, crew.name])),
    'Sin cuadrilla',
  )
}

export interface TrendPoint {
  label: string
  days: number
  people: number
  net: number
}

/** Últimas N semanas de actividad, para ver hacia dónde va la operación. */
export async function weeklyTrend(companyId: string, weeks: number): Promise<TrendPoint[]> {
  const rows = await prisma.payrollWeek.findMany({
    where: { companyId, isOffCycle: false },
    orderBy: [{ startDate: 'desc' }],
    take: weeks,
    include: {
      _count: { select: { workEntries: true } },
      payrolls: { select: { netPay: true, workerId: true } },
      workEntries: {
        where: { dayType: { in: ['FULL_DAY', 'HALF_DAY', 'HOURLY'] } },
        select: { workerId: true },
      },
    },
  })

  return rows
    .reverse()
    .map((week) => ({
      label: `S${week.weekNumber}`,
      days: week.workEntries.length,
      people: new Set(week.workEntries.map((entry) => entry.workerId)).size,
      net: week.payrolls.reduce((sum, payroll) => sum + Number(payroll.netPay), 0),
    }))
}

export interface ControlSignals {
  criticalExceptions: number
  reviewExceptions: number
  workersWithoutRate: number
  unconfirmedRules: number
  daysNotCalculated: number
}

/** Señales de que algo necesita atención. Es lo que el Excel nunca pudo mostrar. */
export async function controlSignals(companyId: string): Promise<ControlSignals> {
  const [critical, review, activeWorkers, withRate, rules, entriesWithoutPayroll] =
    await Promise.all([
      prisma.exception.count({ where: { companyId, status: 'OPEN', level: 'CRITICAL' } }),
      prisma.exception.count({ where: { companyId, status: 'OPEN', level: 'REVIEW_REQUIRED' } }),
      prisma.worker.count({ where: { companyId, status: 'ACTIVE' } }),
      prisma.worker.count({ where: { companyId, status: 'ACTIVE', rates: { some: { active: true } } } }),
      prisma.companySetting.count({
        where: { companyId, needsBusinessConfirmation: true, confirmed: false },
      }),
      prisma.workEntry.count({
        where: {
          companyId,
          dayType: { in: ['FULL_DAY', 'HALF_DAY', 'HOURLY'] },
          payrollWeek: { payrolls: { none: {} } },
        },
      }),
    ])

  return {
    criticalExceptions: critical,
    reviewExceptions: review,
    workersWithoutRate: activeWorkers - withRate,
    unconfirmedRules: rules,
    daysNotCalculated: entriesWithoutPayroll,
  }
}

export interface PipelineRow {
  status: string
  people: number
  net: number
}

export async function payrollPipeline(companyId: string): Promise<PipelineRow[]> {
  const grouped = await prisma.workerPayroll.groupBy({
    by: ['status'],
    where: { companyId },
    _count: { _all: true },
    _sum: { netPay: true },
  })

  return grouped.map((row) => ({
    status: row.status,
    people: row._count._all,
    net: Number(row._sum.netPay ?? 0),
  }))
}
