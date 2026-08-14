import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { type Cents, toCents, toDecimalString } from '@/lib/payroll/engine/money'
import { toIso } from '@/lib/payroll/week'
import { computeMargin, sumMargins, toView, type Margin, type MarginView } from './index'
import {
  explainMissingBillingRate,
  resolveBillingRate,
  type BillingRateInput,
} from './rates'

/**
 * Venta y margen contra la base de datos.
 *
 * Lo que decide vive en `./rates.ts` y `./index.ts`, que son puros. Aquí solo
 * se leen datos, se les aplica esa decisión y se guarda el resultado.
 */

/**
 * Las líneas que representan trabajo hecho, y por tanto se le facturan al
 * cliente. Los adicionales y descuentos NO se cobran: son acuerdos internos.
 */
const BILLABLE = [
  'BASE_DAY',
  'BASE_HALF_DAY',
  'BASE_HOURLY',
  'BASE_WEEKLY',
  'BASE_PRODUCTION',
  'BASE_PIECE',
  'BASE_PERCENTAGE',
] as const

/** Cómo se cobra cada tipo de línea. */
function billingTypeOf(lineType: string): 'DAILY' | 'HOURLY' | 'WEEKLY' | 'PIECE' | 'PERCENTAGE' {
  if (lineType === 'BASE_HOURLY') return 'HOURLY'
  if (lineType === 'BASE_WEEKLY') return 'WEEKLY'
  if (lineType === 'BASE_PIECE' || lineType === 'BASE_PRODUCTION') return 'PIECE'
  if (lineType === 'BASE_PERCENTAGE') return 'PERCENTAGE'
  return 'DAILY'
}

/** Las tarifas de venta de una compañía, ya en centavos. */
export async function billingRatesOf(
  companyId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<BillingRateInput[]> {
  const rows = await tx.billingRate.findMany({
    where: { companyId, active: true },
    orderBy: { effectiveFrom: 'desc' },
  })

  return rows.map((row) => ({
    id: row.id,
    customerId: row.customerId,
    projectId: row.projectId,
    operationId: row.operationId,
    crewId: row.crewId,
    shift: row.shift,
    rateType: row.rateType,
    amount: toCents(row.amount.toFixed(2)),
    effectiveFrom: toIso(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? toIso(row.effectiveTo) : null,
  }))
}

export interface PricedLine {
  lineId: string
  billedRate: Cents | null
  revenue: Cents | null
  billingRateSourceId: string | null
  /** Por qué no hay venta, cuando no la hay. */
  why: string | null
}

/**
 * Le pone precio de VENTA a las líneas ya calculadas de una nómina.
 *
 * El cliente sale del proyecto del día. Un día sin proyecto no tiene a quién
 * facturarse, y eso se dice — no se le asigna el cliente "más probable".
 *
 * Se llama justo después de calcular el costo, dentro de la misma transacción,
 * para que la venta quede congelada igual que la tarifa de costo (BR-200).
 */
export async function priceLines(
  companyId: string,
  tx: Prisma.TransactionClient = prisma,
  workerPayrollId?: string,
): Promise<{ priced: PricedLine[]; revenueTotal: Cents | null; daysWithout: number }> {
  const rates = await billingRatesOf(companyId, tx)

  const lines = await tx.payrollLine.findMany({
    where: {
      ...(workerPayrollId ? { workerPayrollId } : {}),
      lineType: { in: [...BILLABLE] },
    },
    include: { project: { select: { customerId: true, operationId: true } } },
  })

  const priced: PricedLine[] = []
  let revenueTotal: Cents = toCents('0')
  let known = 0
  let daysWithout = 0

  for (const line of lines) {
    const lookup = {
      customerId: line.project?.customerId ?? null,
      projectId: line.projectId,
      operationId: line.project?.operationId ?? null,
      crewId: line.crewId,
      shift: line.shift,
      rateType: billingTypeOf(line.lineType),
      date: line.workDate ? toIso(line.workDate) : '',
    }

    const rate = resolveBillingRate(rates, lookup)

    if (!rate) {
      daysWithout += 1
      priced.push({
        lineId: line.id,
        billedRate: null,
        revenue: null,
        billingRateSourceId: null,
        why: explainMissingBillingRate(rates, lookup),
      })
      continue
    }

    // Se cobra por la misma cantidad por la que se paga: medio día se factura
    // medio, igual que se paga medio.
    const quantity = toCents(line.quantity.toFixed(2))
    const revenue = (rate.amount * quantity) / 100n

    revenueTotal = (revenueTotal + revenue) as Cents
    known += 1
    priced.push({
      lineId: line.id,
      billedRate: rate.amount,
      revenue: revenue as Cents,
      billingRateSourceId: rate.id,
      why: null,
    })
  }

  return {
    priced,
    // Sin una sola línea con venta conocida, el total es "no se sabe", no cero.
    revenueTotal: known === 0 ? null : revenueTotal,
    daysWithout,
  }
}

/**
 * Congela la venta de una nómina recién calculada.
 *
 * Devuelve cuántos días quedaron sin tarifa, para que quien calcula lo vea.
 */
export async function snapshotRevenue(
  companyId: string,
  workerPayrollId: string,
  tx: Prisma.TransactionClient,
): Promise<{ daysWithout: number; firstReason: string | null }> {
  const { priced, revenueTotal, daysWithout } = await priceLines(companyId, tx, workerPayrollId)

  for (const line of priced) {
    await tx.payrollLine.update({
      where: { id: line.lineId },
      data: {
        billedRate: line.billedRate === null ? null : toDecimalString(line.billedRate),
        revenue: line.revenue === null ? null : toDecimalString(line.revenue),
        billingRateSourceId: line.billingRateSourceId,
      },
    })
  }

  await tx.workerPayroll.update({
    where: { id: workerPayrollId },
    data: {
      revenueTotal: revenueTotal === null ? null : toDecimalString(revenueTotal),
      daysWithoutBillingRate: daysWithout,
    },
  })

  return {
    daysWithout,
    firstReason: priced.find((line) => line.why)?.why ?? null,
  }
}

// ─────────────────────────────────────────────────────────────
// Reportes
// ─────────────────────────────────────────────────────────────

/** Estados cuyo dinero ya es real. El borrador no se cuenta como venta. */
const COUNTED = [
  'PREPARED',
  'PENDING_APPROVAL',
  'APPROVED',
  'READY_TO_PAY',
  'PAYMENT_IN_PROCESS',
  'PAID',
  'RECONCILED',
  'CLOSED',
  'IMPORTED_HISTORICAL',
] as const

interface LineRow {
  revenue: Prisma.Decimal | null
  amount: Prisma.Decimal
}

function marginOf(lines: readonly LineRow[]): Margin {
  return computeMargin(
    lines.map((line) => ({
      date: '',
      revenue: line.revenue === null ? null : toCents(line.revenue.toFixed(2)),
      cost: toCents(line.amount.toFixed(2)),
    })),
  )
}

export interface MarginBreakdown {
  key: string
  label: string
  workers: number
  view: MarginView
}

export interface MarginReport {
  total: MarginView
  byWeek: MarginBreakdown[]
  byCrew: MarginBreakdown[]
  byProject: MarginBreakdown[]
}

/**
 * Una fila del margen, venga de un día trabajado o de producción.
 *
 * Las dos cosas conviven en la misma semana —hay cortes donde a la misma
 * cuadrilla le pagan unos días por jornal y otros por pie construido— así que
 * el margen tiene que sumarlas juntas o daría una cifra que no existe.
 */
interface MarginSource {
  revenue: Prisma.Decimal | null
  amount: Prisma.Decimal
  crewId: string | null
  crewName: string | null
  projectId: string | null
  projectName: string | null
  payrollWeekId: string | null
  weekLabel: string | null
  weekStart: Date | null
  /** Trabajador, o la cuadrilla cuando la fila viene de producción. */
  actorId: string
  origin: 'DAY' | 'PRODUCTION'
}

/**
 * Rentabilidad por semana, cuadrilla y proyecto.
 *
 * El costo sale de las líneas de nómina (`amount`), no del neto: descontar un
 * préstamo no abarata la mano de obra — BR-202.
 */
export async function marginReport(
  companyId: string,
  options: { from?: Date; to?: Date } = {},
): Promise<MarginReport> {
  const lines = await prisma.payrollLine.findMany({
    where: {
      lineType: { in: [...BILLABLE] },
      workerPayroll: {
        companyId,
        status: { in: [...COUNTED] },
        ...(options.from || options.to
          ? {
              payrollWeek: {
                ...(options.from ? { startDate: { gte: options.from } } : {}),
                ...(options.to ? { endDate: { lte: options.to } } : {}),
              },
            }
          : {}),
      },
    },
    select: {
      revenue: true,
      amount: true,
      crewId: true,
      projectId: true,
      crew: { select: { name: true } },
      project: { select: { name: true } },
      workerPayroll: {
        select: {
          workerId: true,
          payrollWeekId: true,
          payrollWeek: { select: { label: true, year: true, startDate: true } },
        },
      },
    },
  })

  // Producción: el otro origen de venta y costo de la misma semana.
  const production = await prisma.production.findMany({
    where: {
      companyId,
      ...(options.from || options.to
        ? {
            productionDate: {
              ...(options.from ? { gte: options.from } : {}),
              ...(options.to ? { lte: options.to } : {}),
            },
          }
        : {}),
    },
    select: {
      revenue: true,
      amount: true,
      crewId: true,
      projectId: true,
      crew: { select: { name: true } },
      project: { select: { name: true } },
      payrollWeekId: true,
      payrollWeek: { select: { label: true, year: true, startDate: true } },
    },
  })

  const rows: MarginSource[] = [
    ...lines.map((line) => ({
      revenue: line.revenue,
      amount: line.amount,
      crewId: line.crewId,
      crewName: line.crew?.name ?? null,
      projectId: line.projectId,
      projectName: line.project?.name ?? null,
      payrollWeekId: line.workerPayroll.payrollWeekId,
      weekLabel: `${line.workerPayroll.payrollWeek.label} · ${line.workerPayroll.payrollWeek.year}`,
      weekStart: line.workerPayroll.payrollWeek.startDate,
      actorId: line.workerPayroll.workerId,
      origin: 'DAY' as const,
    })),
    ...production.map((row) => ({
      revenue: row.revenue,
      amount: row.amount,
      crewId: row.crewId,
      crewName: row.crew?.name ?? null,
      projectId: row.projectId,
      projectName: row.project?.name ?? null,
      payrollWeekId: row.payrollWeekId,
      weekLabel: row.payrollWeek
        ? `${row.payrollWeek.label} · ${row.payrollWeek.year}`
        : null,
      weekStart: row.payrollWeek?.startDate ?? null,
      // La producción la hace la cuadrilla, no una persona.
      actorId: row.crewId ?? 'sin-cuadrilla',
      origin: 'PRODUCTION' as const,
    })),
  ]

  function group(
    keyOf: (row: MarginSource) => { key: string; label: string } | null,
    sort?: (a: MarginBreakdown, b: MarginBreakdown) => number,
  ): MarginBreakdown[] {
    const buckets = new Map<
      string,
      { label: string; rows: LineRow[]; workers: Set<string> }
    >()

    for (const line of rows) {
      const at = keyOf(line)
      if (!at) continue
      const bucket = buckets.get(at.key) ?? { label: at.label, rows: [], workers: new Set() }
      bucket.rows.push(line)
      bucket.workers.add(line.actorId)
      buckets.set(at.key, bucket)
    }

    const result = [...buckets.entries()].map(([key, bucket]) => ({
      key,
      label: bucket.label,
      workers: bucket.workers.size,
      view: toView(marginOf(bucket.rows)),
    }))

    return sort ? result.sort(sort) : result.sort((a, b) => a.label.localeCompare(b.label, 'es'))
  }

  const weekStart = new Map<string, Date>()
  for (const line of rows) {
    if (line.payrollWeekId && line.weekStart) weekStart.set(line.payrollWeekId, line.weekStart)
  }

  return {
    total: toView(marginOf(rows)),
    byWeek: group(
      (line) =>
        line.payrollWeekId && line.weekLabel
          ? { key: line.payrollWeekId, label: line.weekLabel }
          : null,
      (a, b) => {
        const left = weekStart.get(a.key)?.getTime() ?? 0
        const right = weekStart.get(b.key)?.getTime() ?? 0
        return right - left
      },
    ),
    byCrew: group((line) =>
      line.crewId ? { key: line.crewId, label: line.crewName ?? 'sin nombre' } : null,
    ),
    byProject: group((line) =>
      line.projectId ? { key: line.projectId, label: line.projectName ?? 'sin nombre' } : null,
    ),
  }
}

/** Margen de una sola semana, para mostrarlo junto a la nómina. */
export async function marginForWeek(companyId: string, payrollWeekId: string): Promise<MarginView> {
  const lines = await prisma.payrollLine.findMany({
    where: {
      lineType: { in: [...BILLABLE] },
      workerPayroll: { companyId, payrollWeekId, status: { in: [...COUNTED] } },
    },
    select: { revenue: true, amount: true },
  })
  return toView(marginOf(lines))
}

/** Margen acumulado del año en curso, para el tablero. */
export async function marginYearToDate(companyId: string, year: number): Promise<MarginView> {
  const lines = await prisma.payrollLine.findMany({
    where: {
      lineType: { in: [...BILLABLE] },
      workerPayroll: {
        companyId,
        status: { in: [...COUNTED] },
        payrollWeek: { year },
      },
    },
    select: { revenue: true, amount: true },
  })
  return toView(marginOf(lines))
}

export { sumMargins }
