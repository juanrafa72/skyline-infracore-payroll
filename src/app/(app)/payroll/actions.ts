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
import { invalidateIfStale } from '@/lib/payroll/workflow/service'
import { removeFromRoster, setRoster } from '@/lib/payroll/roster'

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

/** Acepta "75", "75.5", "$75.00" y devuelve "75.00". Rechaza lo que no sea un monto. */
function normalizeAmount(raw: string): string {
  const cleaned = raw.replace(/[$\s,]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`"${raw}" no es un monto válido. Usa números, con máximo 2 decimales.`)
  }
  return Number(cleaned).toFixed(2)
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

  const extras = new Map<string, { amount: string; note: string }>()
  for (const [key, raw] of formData.entries()) {
    if (key.startsWith('extra:')) {
      const id = key.slice('extra:'.length)
      extras.set(id, { amount: String(raw).trim(), note: extras.get(id)?.note ?? '' })
    } else if (key.startsWith('nota:')) {
      const id = key.slice('nota:'.length)
      extras.set(id, { amount: extras.get(id)?.amount ?? '', note: String(raw).trim() })
    }
  }

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
      const extra = extras.get(`${workerId}:${date}`)
      const amount = extra?.amount ? normalizeAmount(extra.amount) : null
      const note = extra?.note || null

      // Un monto adicional sin explicación no se guarda. La base también lo
      // impide; aquí se avisa con un mensaje entendible en vez de un error crudo.
      if (amount !== null && !note) {
        throw new Error(
          `El adicional del ${date} necesita una nota que explique por qué se paga.`,
        )
      }

      await tx.workEntry.upsert({
        where: {
          companyId_workerId_workDate: { companyId: company.id, workerId, workDate },
        },
        update: {
          dayType,
          payrollWeekId: week.id,
          additionalAmount: amount,
          additionalNote: amount === null ? null : note,
        },
        create: {
          companyId: company.id,
          payrollWeekId: week.id,
          workerId,
          workDate,
          dayType,
          status: dayType === 'NO_WORK' ? 'NO_WORK' : 'WORKED',
          additionalAmount: amount,
          additionalNote: amount === null ? null : note,
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


  /*
   * Si alguna nómina de esta semana ya estaba aprobada y lo que se acaba de
   * guardar la cambió, la aprobación se cae aquí mismo. No se espera a que
   * alguien lo note: un cambio silencioso después de aprobar es exactamente lo
   * que este sistema existe para impedir.
   */
  const approved = await prisma.workerPayroll.findMany({
    where: {
      companyId: company.id,
      payrollWeekId: week.id,
      status: { in: ['APPROVED', 'READY_TO_PAY'] },
    },
    select: { id: true },
  })
  for (const payroll of approved) {
    await invalidateIfStale(payroll.id)
  }

  revalidatePath('/approvals')
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
        additionalAmount: entry.additionalAmount
          ? toCents(entry.additionalAmount.toString())
          : null,
        additionalNote: entry.additionalNote,
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

/** Agrega personas al período, aunque todavía no tengan días marcados. */
export async function addWorkerToPeriod(formData: FormData) {
  const company = await getActiveCompany()
  const weekId = String(formData.get('weekId') ?? '')
  const workerIds = formData.getAll('workerId').map(String).filter(Boolean)
  if (workerIds.length === 0) return

  const week = await prisma.payrollWeek.findFirst({ where: { id: weekId, companyId: company.id } })
  if (!week) throw new Error('Período no encontrado')

  for (const workerId of workerIds) {
    await prisma.payrollWeekMember.upsert({
      where: { payrollWeekId_workerId: { payrollWeekId: week.id, workerId } },
      update: { removedAt: null, removedById: null, removalReason: null },
      create: { companyId: company.id, payrollWeekId: week.id, workerId },
    })
  }

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      action: 'PERIOD_MEMBER_ADDED',
      entityType: 'PayrollWeek',
      entityId: week.id,
      payrollWeekId: week.id,
      newValueJson: { workerIds, count: workerIds.length },
      changedFields: ['members'],
    },
  })

  revalidatePath(`/payroll/${weekId}`)
}


/**
 * Fija quiénes trabajaron en el período.
 *
 * Devuelve un mensaje en vez de lanzar: un error de uso tiene que verse como
 * un aviso en la pantalla, no como un error del sistema.
 */
export async function setPeriodRoster(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const company = await getActiveCompany()
  const weekId = String(formData.get('weekId') ?? '')
  const workerIds = formData.getAll('workerId').map(String).filter(Boolean)

  const result = await setRoster(company.id, weekId, workerIds)
  revalidatePath(`/payroll/${weekId}`)

  if (!result.ok) return result.message
  redirect(`/payroll/${weekId}`)
}

/** Saca a una persona del período. Devuelve mensaje, no lanza. */
export async function removeWorkerFromPeriod(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const company = await getActiveCompany()
  const weekId = String(formData.get('weekId') ?? '')
  const workerId = String(formData.get('workerId') ?? '')

  const result = await removeFromRoster(company.id, weekId, workerId)
  revalidatePath(`/payroll/${weekId}`)
  return result.ok ? `LISTO|${result.message}` : result.message
}

/**
 * Crea una persona con su tarifa y la mete al período, en un solo paso.
 *
 * Una persona sin tarifa no sirve para nada aquí: por eso la tarifa se pide
 * junto con el nombre y no se puede dejar en blanco.
 */
export async function createWorkerWithRate(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const company = await getActiveCompany()

  const name = String(formData.get('name') ?? '').trim()
  const rate = String(formData.get('rate') ?? '').trim()
  const rateType = String(formData.get('rateType') ?? 'DAILY')
  const operationId = String(formData.get('operationId') ?? '').trim()
  const weekId = String(formData.get('weekId') ?? '')

  if (!name) return 'Escribe el nombre.'
  if (!/^\d+(\.\d{1,2})?$/.test(rate)) return 'La tarifa debe ser un número, con máximo 2 decimales.'

  const week = await prisma.payrollWeek.findFirst({ where: { id: weekId, companyId: company.id } })
  if (!week) return 'Período no encontrado.'

  const duplicate = await prisma.worker.findFirst({
    where: { companyId: company.id, displayName: { equals: name, mode: 'insensitive' } },
  })
  if (duplicate) {
    return `Ya existe "${duplicate.displayName}". Búscalo en la lista en vez de crearlo otra vez.`
  }

  const count = await prisma.worker.count({ where: { companyId: company.id } })
  const parts = name.split(/\s+/)

  await prisma.$transaction(async (tx) => {
    const worker = await tx.worker.create({
      data: {
        companyId: company.id,
        code: `W-${String(count + 1).padStart(4, '0')}`,
        firstName: parts[0] ?? name,
        lastName: parts.slice(1).join(' ') || '—',
        displayName: name,
        compensationType: rateType === 'HOURLY' ? 'HOURLY' : 'DAILY_RATE',
        defaultOperationId: operationId || null,
      },
    })

    await tx.workerRate.create({
      data: {
        companyId: company.id,
        workerId: worker.id,
        rateType: rateType === 'HOURLY' ? 'HOURLY' : 'DAILY',
        amount: rate,
        effectiveFrom: week.startDate,
        operationId: operationId || null,
        sourceNote: 'Creada al armar la nómina',
      },
    })

    await tx.payrollWeekMember.create({
      data: { companyId: company.id, payrollWeekId: week.id, workerId: worker.id },
    })

    await tx.auditLog.create({
      data: {
        companyId: company.id,
        action: 'WORKER_CREATED_IN_PAYROLL',
        entityType: 'Worker',
        entityId: worker.id,
        payrollWeekId: week.id,
        newValueJson: { name, rate, rateType },
        changedFields: ['displayName', 'rate'],
      },
    })
  })

  revalidatePath(`/payroll/${weekId}`)
  return `LISTO|${name} agregado con tarifa $${Number(rate).toFixed(2)}`
}
