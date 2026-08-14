import type { CurrentUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { type Cents, ZERO, add, toCents, toDecimalString } from '@/lib/payroll/engine/money'
import { invalidateIfStale } from '@/lib/payroll/workflow/service'
import {
  ADICIONAL,
  DESCUENTO,
  type AdditionCategory,
  type ExtraRow,
  type ManualDeductionCategory,
} from './index'

/**
 * Descuentos y adicionales contra la base de datos.
 *
 * Los tipos y las etiquetas viven en `./index.ts`, que es puro y lo importa
 * también el navegador. Aquí solo lo que necesita Prisma.
 */

/** Las que solo genera el motor. Si aparecen en un formulario, es un error. */
const ENGINE_ONLY = ['ADVANCE_RECOVERY', 'DEBT_RECOVERY']

export interface ExtraResult {
  ok: boolean
  message: string
}

export interface NewExtra {
  weekId: string
  workerId: string
  kind: 'ADDITION' | 'DEDUCTION'
  category: string
  amount: string
  description: string
  /** Día concreto, si aplica. Vacío = toda la semana. */
  workDate?: string | null
}

/**
 * Agrega un descuento o un adicional.
 *
 * Si la persona todavía no tiene nómina en esa semana se le abre una en
 * borrador: si no, habría que calcular antes de poder anotarle el hotel, y
 * nadie trabaja en ese orden.
 */
export async function addExtra(user: CurrentUser, input: NewExtra): Promise<ExtraResult> {
  const description = input.description.trim()
  if (!description) {
    return {
      ok: false,
      message: 'Escribe de qué se trata. Un monto sin explicación no se guarda.',
    }
  }

  if (input.kind === 'DEDUCTION' && ENGINE_ONLY.includes(input.category)) {
    return {
      ok: false,
      message:
        'Las recuperaciones de préstamo no se anotan aquí: las calcula el sistema desde el préstamo. ' +
        'Si hay que descontar algo suelto, usa otra categoría.',
    }
  }

  let amount: Cents
  try {
    amount = toCents(input.amount)
  } catch {
    return { ok: false, message: 'El monto va con máximo 2 decimales.' }
  }
  if (amount <= ZERO) {
    return { ok: false, message: 'El monto tiene que ser mayor que cero.' }
  }

  const week = await prisma.payrollWeek.findFirst({
    where: { id: input.weekId, companyId: user.companyId },
  })
  if (!week) return { ok: false, message: 'Esa semana no existe.' }
  if (week.status === 'CLOSED') return { ok: false, message: 'La semana está cerrada.' }

  const worker = await prisma.worker.findFirst({
    where: { id: input.workerId, companyId: user.companyId },
  })
  if (!worker) return { ok: false, message: 'Esa persona no existe en esta compañía.' }

  const existing = await prisma.workerPayroll.findUnique({
    where: {
      companyId_payrollWeekId_workerId: {
        companyId: user.companyId,
        payrollWeekId: week.id,
        workerId: input.workerId,
      },
    },
  })

  // Una nómina ya pagada no admite cambios. Se corrige con un ajuste — BR/§8.
  if (existing && ['PAID', 'RECONCILED', 'CLOSED'].includes(existing.status)) {
    return {
      ok: false,
      message: `La nómina de ${worker.displayName} ya está pagada. Para corregirla hay que hacer un ajuste, no cambiarla.`,
    }
  }

  const workDate = input.workDate?.trim() ? new Date(`${input.workDate}T00:00:00Z`) : null
  if (workDate && (workDate < week.startDate || workDate > week.endDate)) {
    return { ok: false, message: 'Esa fecha no está dentro de la semana.' }
  }

  await prisma.$transaction(async (tx) => {
    const payroll =
      existing ??
      (await tx.workerPayroll.create({
        data: {
          companyId: user.companyId,
          payrollWeekId: week.id,
          workerId: input.workerId,
          status: 'DRAFT',
        },
      }))

    const data = {
      companyId: user.companyId,
      workerPayrollId: payroll.id,
      amount: toDecimalString(amount),
      description,
      workDate,
      createdById: user.id,
    }

    if (input.kind === 'ADDITION') {
      await tx.addition.create({
        data: { ...data, category: input.category as AdditionCategory },
      })
    } else {
      await tx.deduction.create({
        data: {
          ...data,
          category: input.category as ManualDeductionCategory,
          sourceType: 'MANUAL',
        },
      })
    }

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: input.kind === 'ADDITION' ? 'ADDITION_ADDED' : 'DEDUCTION_ADDED',
        entityType: 'WorkerPayroll',
        entityId: payroll.id,
        payrollWeekId: week.id,
        newValueJson: {
          worker: worker.displayName,
          category: input.category,
          amount: toDecimalString(amount),
          description,
        },
        changedFields: [input.kind === 'ADDITION' ? 'additions' : 'deductions'],
        reason: description,
      },
    })
  })

  /*
   * Un adicional o un descuento cambian lo que la persona recibe, así que son
   * campos materiales: si la nómina ya estaba aprobada, la aprobación se cae
   * sola — regla 5. Se hace aquí y no al recalcular, para que nadie pague
   * contra una aprobación que ya no corresponde a lo que hay.
   */
  const fell = existing ? await invalidateIfStale(existing.id) : false

  const verb = input.kind === 'ADDITION' ? 'Adicional' : 'Descuento'
  return {
    ok: true,
    message:
      `${verb} de $${toDecimalString(amount)} a ${worker.displayName}. ` +
      (fell
        ? 'Su nómina ya estaba aprobada: la aprobación se cayó y hay que volver a revisarla.'
        : 'Vuelve a calcular para que entre al pago.'),
  }
}

/**
 * Quita un descuento o adicional.
 *
 * Solo mientras la nómina siga editable, y nunca los que generó el motor:
 * borrar una recuperación de préstamo a mano dejaría el saldo mintiendo.
 */
export async function removeExtra(
  user: CurrentUser,
  kind: 'ADDITION' | 'DEDUCTION',
  id: string,
): Promise<ExtraResult> {
  if (kind === 'ADDITION') {
    const row = await prisma.addition.findFirst({
      where: { id, companyId: user.companyId },
      include: { workerPayroll: { include: { worker: true } } },
    })
    if (!row) return { ok: false, message: 'Ese adicional ya no existe.' }

    // Pagada no se toca; aprobada sí, y la aprobación se cae — mismo criterio
    // que al agregar. Permitir uno y bloquear el otro sería incoherente.
    if (row.workerPayroll && ['PAID', 'RECONCILED', 'CLOSED'].includes(row.workerPayroll.status)) {
      return {
        ok: false,
        message: `La nómina de ${row.workerPayroll.worker.displayName} ya está pagada. Para corregirla hay que hacer un ajuste.`,
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.addition.delete({ where: { id } })
      await tx.auditLog.create({
        data: {
          companyId: user.companyId,
          userId: user.id,
          userEmailSnapshot: user.email,
          action: 'ADDITION_REMOVED',
          entityType: 'WorkerPayroll',
          entityId: row.workerPayrollId ?? id,
          oldValueJson: {
            worker: row.workerPayroll?.worker.displayName ?? null,
            amount: row.amount.toFixed(2),
            description: row.description,
          },
          changedFields: ['additions'],
          reason: row.description,
        },
      })
    })

    const fell = row.workerPayrollId ? await invalidateIfStale(row.workerPayrollId) : false
    return {
      ok: true,
      message: fell
        ? 'Adicional quitado. La nómina estaba aprobada: la aprobación se cayó.'
        : 'Adicional quitado. Vuelve a calcular.',
    }
  }

  const row = await prisma.deduction.findFirst({
    where: { id, companyId: user.companyId },
    include: { workerPayroll: { include: { worker: true } } },
  })
  if (!row) return { ok: false, message: 'Ese descuento ya no existe.' }

  if (row.sourceType !== 'MANUAL') {
    return {
      ok: false,
      message:
        'Ese descuento lo generó el sistema desde un préstamo. Para quitarlo hay que tocar el préstamo, no el descuento.',
    }
  }
  if (row.workerPayroll && ['PAID', 'RECONCILED', 'CLOSED'].includes(row.workerPayroll.status)) {
    return {
      ok: false,
      message: `La nómina de ${row.workerPayroll.worker.displayName} ya está pagada. Para corregirla hay que hacer un ajuste.`,
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.deduction.delete({ where: { id } })
    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'DEDUCTION_REMOVED',
        entityType: 'WorkerPayroll',
        entityId: row.workerPayrollId ?? id,
        oldValueJson: {
          worker: row.workerPayroll?.worker.displayName ?? null,
          amount: row.amount.toFixed(2),
          description: row.description,
        },
        changedFields: ['deductions'],
        reason: row.description,
      },
    })
  })

  const fell = row.workerPayrollId ? await invalidateIfStale(row.workerPayrollId) : false
  return {
    ok: true,
    message: fell
      ? 'Descuento quitado. La nómina estaba aprobada: la aprobación se cayó.'
      : 'Descuento quitado. Vuelve a calcular.',
  }
}

// ─────────────────────────────────────────────────────────────
// Consulta
// ─────────────────────────────────────────────────────────────

export interface WeekExtras {
  rows: ExtraRow[]
  additionsTotal: string
  deductionsTotal: string
  /** Cuántas personas tienen algo anotado. */
  people: number
}

export async function weekExtras(companyId: string, weekId: string): Promise<WeekExtras> {
  const payrolls = await prisma.workerPayroll.findMany({
    where: { companyId, payrollWeekId: weekId },
    include: {
      worker: { select: { displayName: true } },
      additions: { orderBy: { createdAt: 'asc' } },
      deductions: { orderBy: { createdAt: 'asc' } },
    },
  })

  const rows: ExtraRow[] = []
  let additionsTotal = ZERO
  let deductionsTotal = ZERO
  const people = new Set<string>()

  for (const payroll of payrolls) {
    // Se puede tocar mientras no se haya pagado. Si estaba aprobada, tocarla
    // tumba la aprobación — y eso se avisa al hacerlo.
    const editable = !['PAID', 'RECONCILED', 'CLOSED'].includes(payroll.status)

    for (const row of payroll.additions) {
      additionsTotal = add(additionsTotal, toCents(row.amount.toFixed(2)))
      people.add(payroll.workerId)
      rows.push({
        id: row.id,
        kind: 'ADDITION',
        workerId: payroll.workerId,
        workerName: payroll.worker.displayName,
        categoryLabel: ADICIONAL[row.category as AdditionCategory] ?? row.category,
        amount: row.amount.toFixed(2),
        description: row.description,
        workDate: row.workDate ? row.workDate.toISOString().slice(0, 10) : null,
        removable: editable,
        locked: !editable,
      })
    }

    for (const row of payroll.deductions) {
      deductionsTotal = add(deductionsTotal, toCents(row.amount.toFixed(2)))
      people.add(payroll.workerId)
      const fromEngine = row.sourceType !== 'MANUAL'
      rows.push({
        id: row.id,
        kind: 'DEDUCTION',
        workerId: payroll.workerId,
        workerName: payroll.worker.displayName,
        categoryLabel: fromEngine
          ? 'Recuperación de préstamo'
          : (DESCUENTO[row.category as ManualDeductionCategory] ?? row.category),
        amount: row.amount.toFixed(2),
        description: row.description,
        workDate: row.workDate ? row.workDate.toISOString().slice(0, 10) : null,
        removable: editable && !fromEngine,
        locked: !editable,
      })
    }
  }

  rows.sort(
    (a, b) => a.workerName.localeCompare(b.workerName, 'es') || a.kind.localeCompare(b.kind),
  )

  return {
    rows,
    additionsTotal: toDecimalString(additionsTotal),
    deductionsTotal: toDecimalString(deductionsTotal),
    people: people.size,
  }
}
