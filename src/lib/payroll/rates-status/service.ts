import { Prisma } from '@prisma/client'
import type { CurrentUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { explainMissingRate, resolveRate } from '@/lib/payroll/engine'
import { toCents, toDecimalString } from '@/lib/payroll/engine/money'
import type { RateInput, WorkEntryInput } from '@/lib/payroll/engine/types'
import { toIso } from '@/lib/payroll/week'
import { rateTypeFor, type RateStatusRow, type RatesStatus } from './index'

/**
 * Quién tiene tarifa y quién no — la parte que consulta la base.
 *
 * La respuesta se calcula con `resolveRate`, el mismo código que decide lo que
 * se paga. Si esta pantalla dice "le falta", el cálculo va a reventar; si dice
 * "tiene", el cálculo va a pasar. No hay una tercera opinión.
 */

/**
 * Estado de tarifas de todas las personas activas de la compañía.
 *
 * `onDate` es el día contra el que se evalúa la vigencia (normalmente hoy, o
 * el inicio de la semana que se va a armar).
 */
export async function ratesStatus(companyId: string, onDate: string): Promise<RatesStatus> {
  const [workers, rates] = await Promise.all([
    prisma.worker.findMany({
      where: { companyId, status: 'ACTIVE' },
      orderBy: { displayName: 'asc' },
      select: {
        id: true,
        displayName: true,
        code: true,
        compensationType: true,
        defaultProjectId: true,
        defaultOperationId: true,
      },
    }),
    prisma.workerRate.findMany({ where: { companyId, active: true } }),
  ])

  const ratesByWorker = new Map<string, RateInput[]>()
  for (const rate of rates) {
    const input: RateInput = {
      id: rate.id,
      rateType: rate.rateType,
      amount: toCents(rate.amount.toString()),
      shift: rate.shift,
      projectId: rate.projectId,
      operationId: rate.operationId,
      effectiveFrom: toIso(rate.effectiveFrom),
      effectiveTo: rate.effectiveTo ? toIso(rate.effectiveTo) : null,
    }
    const list = ratesByWorker.get(rate.workerId)
    if (list) list.push(input)
    else ratesByWorker.set(rate.workerId, [input])
  }

  const needsRate: RateStatusRow[] = []
  const nonRateBased: Array<{ workerId: string; name: string; compensationType: RateStatusRow['compensationType'] }> = []

  for (const worker of workers) {
    const rateType = rateTypeFor(worker.compensationType)
    if (rateType === null) {
      nonRateBased.push({
        workerId: worker.id,
        name: worker.displayName,
        compensationType: worker.compensationType,
      })
      continue
    }

    const own = ratesByWorker.get(worker.id) ?? []

    if (rateType === 'WEEKLY') {
      /*
       * El semanal fijo se espeja tal cual lo hace `calculateWeek`: toma
       * cualquier tarifa WEEKLY activa, sin mirar vigencia. Usar aquí una
       * regla más estricta haría que esta pantalla dijera "le falta" a alguien
       * que el cálculo sí va a pagar — y una pantalla que exagera se deja de
       * creer.
       */
      const weekly = own.find((rate) => rate.rateType === 'WEEKLY')
      needsRate.push({
        workerId: worker.id,
        name: worker.displayName,
        code: worker.code,
        compensationType: worker.compensationType,
        rateType,
        resolvedAmount: weekly ? toDecimalString(weekly.amount) : null,
        why: weekly ? null : 'Es de pago semanal fijo y no tiene monto semanal configurado.',
      })
      continue
    }

    const syntheticEntry: WorkEntryInput = {
      id: 'status-check',
      workDate: onDate,
      dayType: rateType === 'HOURLY' ? 'HOURLY' : 'FULL_DAY',
      hoursWorked: null,
      shift: 'DAY',
      projectId: worker.defaultProjectId,
      crewId: null,
      operationId: worker.defaultOperationId,
    }

    const resolved = resolveRate(own, {
      workDate: onDate,
      rateType,
      shift: 'DAY',
      projectId: worker.defaultProjectId,
      operationId: worker.defaultOperationId,
    })

    needsRate.push({
      workerId: worker.id,
      name: worker.displayName,
      code: worker.code,
      compensationType: worker.compensationType,
      rateType,
      resolvedAmount: resolved ? toDecimalString(resolved.amount) : null,
      why: resolved ? null : explainMissingRate(own, syntheticEntry, rateType === 'HOURLY'),
    })
  }

  return {
    needsRate,
    missing: needsRate.filter((row) => row.resolvedAmount === null),
    nonRateBased,
  }
}

/** Solo el conteo, para las señales del dashboard. */
export async function workersMissingRateCount(companyId: string, onDate: string): Promise<number> {
  const status = await ratesStatus(companyId, onDate)
  return status.missing.length
}

export interface SaveRateResult {
  ok: boolean
  message: string
}

const MONEY = /^\d+(\.\d{1,2})?$/

/**
 * Guarda la tarifa general de una persona, cerrando la anterior si la hay.
 *
 * Solo alcance general (sin proyecto, sin operación, turno cualquiera): las
 * tarifas amarradas a un proyecto o turno se manejan en la ficha del
 * trabajador, donde se ve el historial completo.
 *
 * OJO con la vigencia: en WorkerRate `effectiveTo` es EXCLUSIVO — una tarifa
 * con `effectiveTo = 2026-08-16` NO aplica el 16. Por eso la anterior se
 * cierra con `effectiveTo = desde` y la nueva arranca ese mismo día, sin
 * hueco y sin solape (la restricción de la base usa rangos `[desde, hasta)`).
 * En BillingRate el cierre es "el día antes" porque allá es inclusivo:
 * copiar aquel código aquí dejaría un día sin tarifa.
 */
export async function saveMissingRate(
  user: CurrentUser,
  input: { workerId: string; amount: string; effectiveFrom: string },
): Promise<SaveRateResult> {
  const amount = input.amount.trim()
  if (!MONEY.test(amount)) {
    return { ok: false, message: 'El monto va en números con máximo 2 decimales (ej. 180 o 180.50).' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
    return { ok: false, message: 'Falta desde cuándo aplica.' }
  }

  const worker = await prisma.worker.findFirst({
    where: { id: input.workerId, companyId: user.companyId },
  })
  if (!worker) return { ok: false, message: 'Esa persona no existe en esta compañía.' }

  const rateType = rateTypeFor(worker.compensationType)
  if (rateType === null) {
    return {
      ok: false,
      message: `${worker.displayName} se paga por ${worker.compensationType === 'PRODUCTION' ? 'producción' : 'otra modalidad'} y no lleva tarifa de costo.`,
    }
  }

  const from = new Date(`${input.effectiveFrom}T00:00:00Z`)

  const previous = await prisma.workerRate.findFirst({
    where: {
      companyId: user.companyId,
      workerId: worker.id,
      rateType,
      shift: 'ANY',
      projectId: null,
      operationId: null,
      active: true,
      effectiveTo: null,
    },
  })

  if (previous && previous.effectiveFrom >= from) {
    return {
      ok: false,
      message: `Ya tiene una tarifa vigente desde el ${toIso(previous.effectiveFrom)}. La nueva tiene que empezar después.`,
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (previous) {
        await tx.workerRate.update({
          where: { id: previous.id },
          data: { effectiveTo: from },
        })
      }

      const created = await tx.workerRate.create({
        data: {
          companyId: user.companyId,
          workerId: worker.id,
          rateType,
          amount,
          shift: 'ANY',
          effectiveFrom: from,
          approvedById: user.id,
          approvedAt: new Date(),
          sourceNote: 'Pantalla de tarifas faltantes',
        },
      })

      await tx.auditLog.create({
        data: {
          companyId: user.companyId,
          userId: user.id,
          userEmailSnapshot: user.email,
          action: 'RATE_CREATED',
          entityType: 'WorkerRate',
          entityId: created.id,
          oldValueJson: previous
            ? { amount: previous.amount.toFixed(2), closedOn: input.effectiveFrom }
            : Prisma.DbNull,
          newValueJson: {
            worker: worker.displayName,
            amount,
            rateType,
            from: input.effectiveFrom,
          },
          changedFields: ['amount', 'effectiveFrom'],
          reason: 'Pantalla de tarifas faltantes',
        },
      })
    })
  } catch {
    // La restricción de no-solape de la base puede rechazar (BR-035). Mejor un
    // mensaje por fila que un error de Postgres tapando a las demás.
    return {
      ok: false,
      message: `No se pudo guardar la de ${worker.displayName}: choca con otra tarifa suya ya registrada. Revísala en su ficha.`,
    }
  }

  return {
    ok: true,
    message: previous
      ? `${worker.displayName}: $${amount} desde el ${input.effectiveFrom}; la anterior de $${previous.amount.toFixed(2)} quedó cerrada.`
      : `${worker.displayName}: $${amount} desde el ${input.effectiveFrom}.`,
  }
}
