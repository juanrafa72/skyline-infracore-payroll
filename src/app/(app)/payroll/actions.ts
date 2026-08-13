'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import {
  DEFAULT_SETTINGS,
  calculateWorkerPayroll,
  toCents,
  toDecimalString,
  type AdditionInput,
  type CalculationInput,
  type DayType,
  type DeductionInput,
  type RateInput,
  type WorkEntryInput,
} from '@/lib/payroll/engine'
import { offCyclePeriod, periodOf, type PayPeriodType } from '@/lib/payroll/period'
import { toIso } from '@/lib/payroll/week'

/**
 * Abre un período de pago.
 *
 * Dos modos:
 *  - regular: se elige la frecuencia (diario, semanal, catorcenal, quincenal,
 *    mensual) y el sistema calcula las fechas del ciclo que contiene la fecha dada.
 *  - corte: se dan las fechas a mano. Sirve para liquidar a alguien que se retira
 *    sin esperar el cierre normal. Queda marcado como corte para que no se
 *    confunda con un período regular.
 */
export async function openWeek(formData: FormData) {
  const company = await getActiveCompany()
  const mode = String(formData.get('mode') ?? 'regular')

  const period =
    mode === 'cut'
      ? offCyclePeriod(String(formData.get('cutFrom') ?? ''), String(formData.get('cutTo') ?? ''))
      : periodOf(
          String(formData.get('date') ?? ''),
          (String(formData.get('periodType') ?? 'WEEKLY') as PayPeriodType),
          company.biweeklyAnchor ? { biweeklyAnchor: toIso(company.biweeklyAnchor) } : {},
        )

  const isCut = mode === 'cut'
  const settlementType = isCut
    ? (String(formData.get('settlementType') ?? 'FINAL_SETTLEMENT') as 'FINAL_SETTLEMENT' | 'PARTIAL_CUT')
    : 'REGULAR'

  const week = await prisma.payrollWeek.upsert({
    where: {
      companyId_year_weekNumber: {
        companyId: company.id,
        year: period.year,
        weekNumber: period.periodNumber,
      },
    },
    update: {},
    create: {
      companyId: company.id,
      year: period.year,
      weekNumber: period.periodNumber,
      startDate: new Date(`${period.startDate}T00:00:00Z`),
      endDate: new Date(`${period.endDate}T00:00:00Z`),
      label: period.label,
      periodType: period.periodType,
      isOffCycle: isCut,
      settlementType,
      offCycleReason: isCut ? String(formData.get('cutReason') ?? '') || null : null,
    },
  })

  revalidatePath('/payroll')
  redirect(`/payroll/${week.id}`)
}

/**
 * Guarda la rejilla de días. Un día vacío significa "sin registro" y se borra;
 * no se guarda como NO_WORK implícito, porque no es lo mismo no haber trabajado
 * que no haberlo registrado todavía.
 */
export async function saveWorkEntries(formData: FormData) {
  const company = await getActiveCompany()
  const weekId = String(formData.get('weekId') ?? '')

  const week = await prisma.payrollWeek.findFirst({
    where: { id: weekId, companyId: company.id },
  })
  if (!week) throw new Error('Semana no encontrada')
  if (week.status === 'CLOSED') throw new Error('La semana está cerrada')

  const operations = new Map<string, { workerId: string; date: string; value: string }>()
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith('day:')) continue
    const [, workerId, date] = key.split(':')
    if (!workerId || !date) continue
    const value = String(raw)
    // Si el mismo día llegara repetido, gana el valor con contenido: un campo
    // vacío nunca debe borrar una marca que el usuario sí hizo.
    const previous = operations.get(key)
    if (previous && previous.value !== '' && value === '') continue
    operations.set(key, { workerId, date, value })
  }

  let saved = 0
  let cleared = 0

  await prisma.$transaction(async (tx) => {
    for (const { workerId, date, value } of operations.values()) {
      const workDate = new Date(`${date}T00:00:00Z`)

      if (value === '') {
        const deleted = await tx.workEntry.deleteMany({
          where: { companyId: company.id, workerId, workDate },
        })
        cleared += deleted.count
        continue
      }

      const dayType = value as DayType
      await tx.workEntry.upsert({
        where: {
          companyId_workerId_workDate: { companyId: company.id, workerId, workDate },
        },
        update: { dayType, payrollWeekId: week.id },
        create: {
          companyId: company.id,
          payrollWeekId: week.id,
          workerId,
          workDate,
          dayType,
          status: dayType === 'NO_WORK' ? 'NO_WORK' : 'WORKED',
        },
      })
      saved += 1
    }

    await tx.auditLog.create({
      data: {
        companyId: company.id,
        action: 'WORK_ENTRIES_SAVED',
        entityType: 'PayrollWeek',
        entityId: week.id,
        payrollWeekId: week.id,
        newValueJson: { saved, cleared },
        changedFields: ['workEntries'],
      },
    })
  })

  revalidatePath(`/payroll/${weekId}`)
}

/**
 * Recalcula la nómina de la semana con el PayrollEngine.
 *
 * Solo toca nóminas en estado editable. Una nómina aprobada o pagada no se
 * recalcula por aquí: cambiarla exige el flujo de invalidación de aprobación.
 */
export async function calculateWeek(formData: FormData) {
  const company = await getActiveCompany()
  const weekId = String(formData.get('weekId') ?? '')

  const week = await prisma.payrollWeek.findFirst({
    where: { id: weekId, companyId: company.id },
    include: {
      workEntries: { include: { worker: true } },
    },
  })
  if (!week) throw new Error('Semana no encontrada')

  const workerIds = [...new Set(week.workEntries.map((entry) => entry.workerId))]

  const [workers, rates, additions, deductions] = await Promise.all([
    prisma.worker.findMany({ where: { id: { in: workerIds } } }),
    prisma.workerRate.findMany({ where: { workerId: { in: workerIds }, active: true } }),
    prisma.addition.findMany({
      where: { companyId: company.id, workerPayroll: { payrollWeekId: week.id } },
    }),
    prisma.deduction.findMany({
      where: {
        companyId: company.id,
        workerPayroll: { payrollWeekId: week.id },
        sourceType: 'MANUAL',
      },
    }),
  ])

  const workerById = new Map(workers.map((worker) => [worker.id, worker]))

  for (const workerId of workerIds) {
    const worker = workerById.get(workerId)
    if (!worker) continue

    const existing = await prisma.workerPayroll.findUnique({
      where: {
        companyId_payrollWeekId_workerId: {
          companyId: company.id,
          payrollWeekId: week.id,
          workerId,
        },
      },
    })

    // Una nómina aprobada o pagada no se recalcula en silencio.
    if (existing && !['DRAFT', 'PREPARED', 'REJECTED'].includes(existing.status)) continue

    const entries: WorkEntryInput[] = week.workEntries
      .filter((entry) => entry.workerId === workerId)
      .map((entry) => ({
        id: entry.id,
        workDate: toIso(entry.workDate),
        dayType: entry.dayType as DayType,
        hoursWorked: entry.hoursWorked?.toString() ?? null,
        shift: entry.shift,
        projectId: entry.projectId,
        crewId: entry.crewId,
        operationId: entry.operationId,
      }))

    const workerRates: RateInput[] = rates
      .filter((rate) => rate.workerId === workerId)
      .map((rate) => ({
        id: rate.id,
        rateType: rate.rateType,
        amount: toCents(rate.amount.toString()),
        shift: rate.shift,
        projectId: rate.projectId,
        operationId: rate.operationId,
        effectiveFrom: toIso(rate.effectiveFrom),
        effectiveTo: rate.effectiveTo ? toIso(rate.effectiveTo) : null,
      }))

    const workerAdditions: AdditionInput[] = additions
      .filter((addition) => addition.workerPayrollId === existing?.id)
      .map((addition) => ({
        id: addition.id,
        category: addition.category,
        amount: toCents(addition.amount.toString()),
        description: addition.description,
      }))

    const workerDeductions: DeductionInput[] = deductions
      .filter((deduction) => deduction.workerPayrollId === existing?.id)
      .map((deduction) => ({
        id: deduction.id,
        category: deduction.category,
        amount: toCents(deduction.amount.toString()),
        description: deduction.description,
      }))

    const input: CalculationInput = {
      workerId,
      compensationType: worker.compensationType,
      fixedWeeklyAmount:
        worker.compensationType === 'FIXED_WEEKLY'
          ? (workerRates.find((rate) => rate.rateType === 'WEEKLY')?.amount ?? null)
          : null,
      entries,
      rates: workerRates,
      additions: workerAdditions,
      manualDeductions: workerDeductions,
      advances: [],
      debts: [],
      settings: DEFAULT_SETTINGS,
    }

    const result = calculateWorkerPayroll(input)

    await prisma.$transaction(async (tx) => {
      const payroll = await tx.workerPayroll.upsert({
        where: {
          companyId_payrollWeekId_workerId: {
            companyId: company.id,
            payrollWeekId: week.id,
            workerId,
          },
        },
        update: {
          status: 'PREPARED',
          daysFull: result.daysFull,
          daysHalf: result.daysHalf,
          daysNoWork: result.daysNoWork,
          hoursTotal: result.hoursTotal,
          basePay: toDecimalString(result.basePay),
          additionsTotal: toDecimalString(result.additionsTotal),
          grossPay: toDecimalString(result.grossPay),
          deductionsTotal: toDecimalString(result.deductionsTotal),
          netPay: toDecimalString(result.netPay),
          preparedAt: new Date(),
        },
        create: {
          companyId: company.id,
          payrollWeekId: week.id,
          workerId,
          status: 'PREPARED',
          daysFull: result.daysFull,
          daysHalf: result.daysHalf,
          daysNoWork: result.daysNoWork,
          hoursTotal: result.hoursTotal,
          basePay: toDecimalString(result.basePay),
          additionsTotal: toDecimalString(result.additionsTotal),
          grossPay: toDecimalString(result.grossPay),
          deductionsTotal: toDecimalString(result.deductionsTotal),
          netPay: toDecimalString(result.netPay),
          preparedAt: new Date(),
        },
      })

      await tx.payrollLine.deleteMany({ where: { workerPayrollId: payroll.id } })
      await tx.payrollLine.createMany({
        data: result.lines.map((line) => ({
          workerPayrollId: payroll.id,
          workEntryId: line.workEntryId,
          lineType: line.lineType,
          workDate: line.workDate ? new Date(`${line.workDate}T00:00:00Z`) : null,
          quantity: line.quantity,
          appliedRate: toDecimalString(line.appliedRate),
          rateSourceId: line.rateSourceId,
          amount: toDecimalString(line.amount),
          projectId: line.projectId,
          crewId: line.crewId,
          shift: line.shift,
          description: line.description,
        })),
      })

      await tx.exception.deleteMany({
        where: { companyId: company.id, payrollWeekId: week.id, workerId, status: 'OPEN' },
      })
      if (result.exceptions.length > 0) {
        await tx.exception.createMany({
          data: result.exceptions.map((exception) => ({
            companyId: company.id,
            code: exception.code,
            level: exception.level,
            entityType: 'WorkerPayroll',
            entityId: payroll.id,
            payrollWeekId: week.id,
            workerId,
            title: exception.title,
            detail: exception.detail,
          })),
        })
      }

      await tx.auditLog.create({
        data: {
          companyId: company.id,
          action: 'PAYROLL_CALCULATED',
          entityType: 'WorkerPayroll',
          entityId: payroll.id,
          payrollWeekId: week.id,
          newValueJson: {
            worker: worker.displayName,
            gross: toDecimalString(result.grossPay),
            net: toDecimalString(result.netPay),
          },
          changedFields: ['grossPay', 'netPay'],
        },
      })
    })
  }

  revalidatePath(`/payroll/${weekId}`)
}
