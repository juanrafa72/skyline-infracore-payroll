import { prisma } from '@/lib/db/client'
import type { CurrentUser } from '@/lib/auth/rbac'
import { canDetach, detachFromOrder } from '@/lib/disbursement/detach'
import { toIso } from '@/lib/payroll/week'
import {
  LABELS,
  approvalIsStale,
  assertTransition,
  calculationHash,
  isSelfApproval,
  type MaterialFields,
  type PayrollStatus,
  type WorkflowAction,
} from './index'

/**
 * Ejecuta transiciones de nómina contra la base de datos.
 *
 * Todo lo que decide está en `./index.ts`, que es puro y se prueba solo. Aquí
 * únicamente se leen los datos, se aplica la decisión y se deja registro.
 */

/** Reúne los campos que, si cambian, obligan a aprobar otra vez. */
export async function buildMaterialFields(workerPayrollId: string): Promise<MaterialFields> {
  const payroll = await prisma.workerPayroll.findUniqueOrThrow({
    where: { id: workerPayrollId },
    include: {
      lines: { orderBy: { workDate: 'asc' } },
      additions: true,
      deductions: true,
      payrollWeek: true,
    },
  })

  const entries = await prisma.workEntry.findMany({
    where: {
      companyId: payroll.companyId,
      workerId: payroll.workerId,
      payrollWeekId: payroll.payrollWeekId,
    },
    orderBy: { workDate: 'asc' },
  })

  return {
    workerId: payroll.workerId,
    days: entries.map((entry) => ({
      date: toIso(entry.workDate),
      dayType: entry.dayType,
      hours: entry.hoursWorked?.toString() ?? null,
      shift: entry.shift,
      projectId: entry.projectId,
      crewId: entry.crewId,
      additionalAmount: entry.additionalAmount?.toFixed(2) ?? null,
      additionalNote: entry.additionalNote,
    })),
    rates: payroll.lines.map((line) => ({
      date: line.workDate ? toIso(line.workDate) : '',
      amount: line.appliedRate.toFixed(2),
      rateId: line.rateSourceId,
    })),
    additions: payroll.additions.map((row) => ({
      category: row.category,
      amount: row.amount.toFixed(2),
      description: row.description,
    })),
    deductions: payroll.deductions.map((row) => ({
      category: row.category,
      amount: row.amount.toFixed(2),
      description: row.description,
    })),
    advanceRecoveries: payroll.deductions
      .filter((row) => row.advanceRecoveryId)
      .map((row) => ({ advanceId: row.advanceRecoveryId!, amount: row.amount.toFixed(2) })),
    debtRecoveries: payroll.deductions
      .filter((row) => row.debtTransactionId)
      .map((row) => ({ debtId: row.debtTransactionId!, amount: row.amount.toFixed(2) })),
    grossPay: payroll.grossPay.toFixed(2),
    netPay: payroll.netPay.toFixed(2),
  }
}

export async function currentHash(workerPayrollId: string): Promise<string> {
  return calculationHash(await buildMaterialFields(workerPayrollId))
}

/**
 * Revisa si una nómina aprobada dejó de coincidir con lo que se aprobó.
 *
 * De ser así la devuelve a "esperando aprobación", deja la excepción y lo
 * registra. Nunca se corrige el estado en silencio.
 */
export async function invalidateIfStale(workerPayrollId: string): Promise<boolean> {
  const payroll = await prisma.workerPayroll.findUniqueOrThrow({
    where: { id: workerPayrollId },
  })

  if (!['APPROVED', 'READY_TO_PAY'].includes(payroll.status)) return false

  const hash = await currentHash(workerPayrollId)
  if (!approvalIsStale(payroll.calculationHash, hash)) return false

  await prisma.$transaction(async (tx) => {
    /*
     * Si ya había una orden de desembolso, la persona sale de ella y el total
     * se recalcula. Dejarla dentro con el monto viejo haría que tesorería
     * transfiriera una cifra que ya no corresponde a lo aprobado.
     *
     * Si la orden ya movió dinero no se puede sacar, y así queda: la
     * excepción crítica obliga a revisarlo a mano, que es lo correcto cuando
     * el dinero ya salió.
     */
    const detached = await detachFromOrder(tx, workerPayrollId, 'cambió algo después de aprobar')

    await tx.workerPayroll.update({
      where: { id: workerPayrollId },
      data: {
        status: 'PENDING_APPROVAL',
        approvedById: null,
        approvedAt: null,
        approvalInvalidatedAt: new Date(),
        approvalInvalidatedReason: 'Cambió algo después de aprobar',
        calculationHash: hash,
      },
    })

    await tx.exception.create({
      data: {
        companyId: payroll.companyId,
        code: 'CHANGED_AFTER_APPROVAL',
        level: 'CRITICAL',
        entityType: 'WorkerPayroll',
        entityId: workerPayrollId,
        payrollWeekId: payroll.payrollWeekId,
        workerId: payroll.workerId,
        title: 'Cambió después de aprobar',
        detail:
          'Se modificó algo que afecta el pago después de la aprobación. La nómina volvió a ' +
          'esperar aprobación y debe revisarse de nuevo.' +
          (detached.orderNumber && detached.ok
            ? ` Salió de la orden ${detached.orderNumber}, cuyo total se recalculó.`
            : '') +
          (detached.ok
            ? ''
            : ` OJO: sigue en la orden ${detached.orderNumber}, que ya tiene dinero desembolsado. Hay que revisarlo a mano.`),
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: payroll.companyId,
        action: 'APPROVAL_INVALIDATED',
        entityType: 'WorkerPayroll',
        entityId: workerPayrollId,
        payrollWeekId: payroll.payrollWeekId,
        oldValueJson: { status: payroll.status, hash: payroll.calculationHash },
        newValueJson: { status: 'PENDING_APPROVAL', hash },
        changedFields: ['status', 'calculationHash'],
        reason: 'Cambió algo material después de aprobar',
      },
    })
  })

  return true
}

export interface TransitionResult {
  moved: number
  skipped: Array<{ workerName: string; reason: string }>
}

/** Aplica una acción del flujo a un conjunto de nóminas. */
export async function applyTransition(
  user: CurrentUser,
  workerPayrollIds: readonly string[],
  action: WorkflowAction,
  reason?: string | null,
): Promise<TransitionResult> {
  const result: TransitionResult = { moved: 0, skipped: [] }

  /*
   * Modo de una sola persona.
   *
   * Cuando está activo, quien preparó puede aprobar y quien aprobó puede pagar.
   * Se guarda por compañía y cada uso queda marcado, para que después se pueda
   * revisar qué pasó sin un segundo par de ojos.
   */
  const setting = await prisma.companySetting.findUnique({
    where: { companyId_key: { companyId: user.companyId, key: 'workflow.allow_self_approval' } },
  })
  const allowSelfApproval = setting?.value === 'true'

  for (const id of workerPayrollIds) {
    const payroll = await prisma.workerPayroll.findFirst({
      where: { id, companyId: user.companyId },
      include: { worker: true },
    })
    if (!payroll) continue

    let next: PayrollStatus
    try {
      next = assertTransition({
        action,
        current: payroll.status as PayrollStatus,
        actorId: user.id,
        permissions: user.permissions,
        preparedById: payroll.preparedById,
        approvedById: payroll.approvedById,
        reason: reason ?? null,
        allowSelfApproval,
      })
    } catch (error) {
      result.skipped.push({
        workerName: payroll.worker.displayName,
        reason: (error as Error).message,
      })
      continue
    }

    /*
     * Aprobar es decidir a dónde va el dinero, no solo cuánto.
     *
     * Sin empresa receptora asignada no se puede saber a quién transferirle, y
     * una nómina aprobada así llegaría a tesorería sin destino. Se bloquea
     * aquí, en el único sitio por donde pasan todas las aprobaciones — BR-180.
     */
    if (action === 'APPROVE' && !payroll.paymentRecipientId) {
      result.skipped.push({
        workerName: payroll.worker.displayName,
        reason: 'No tiene empresa receptora asignada. Asígnasela antes de aprobar.',
      })
      continue
    }

    // Antes de aprobar se exige que no queden errores críticos abiertos.
    if (action === 'APPROVE') {
      const critical = await prisma.exception.count({
        where: {
          companyId: user.companyId,
          entityId: payroll.id,
          level: 'CRITICAL',
          status: 'OPEN',
        },
      })
      if (critical > 0) {
        result.skipped.push({
          workerName: payroll.worker.displayName,
          reason: `Tiene ${critical} error(es) crítico(s) sin resolver.`,
        })
        continue
      }
    }

    /*
     * Devolver una nómina que ya está en una orden de desembolso.
     *
     * Si la orden todavía no ha movido dinero, la persona sale de la orden y
     * el total se recalcula. Si ya movió, no se devuelve: hacerlo dejaría a
     * tesorería con un documento que no corresponde a nadie.
     */
    if (action === 'RETURN') {
      const detachable = await canDetach(payroll.id)
      if (!detachable.ok) {
        result.skipped.push({
          workerName: payroll.worker.displayName,
          reason: detachable.reason ?? 'Ya tiene dinero desembolsado.',
        })
        continue
      }
    }

    const hash = await currentHash(payroll.id)
    const withoutSecondPair = isSelfApproval({
      action,
      current: payroll.status as PayrollStatus,
      actorId: user.id,
      permissions: user.permissions,
      preparedById: payroll.preparedById,
      approvedById: payroll.approvedById,
    })

    await prisma.$transaction(async (tx) => {
      if (action === 'RETURN') {
        await detachFromOrder(tx, payroll.id, reason?.trim() || 'devuelta a aprobación')
      }

      await tx.workerPayroll.update({
        where: { id: payroll.id },
        data: {
          status: next,
          ...(action === 'SUBMIT'
            ? { preparedById: user.id, preparedAt: new Date(), calculationHash: hash }
            : {}),
          ...(action === 'APPROVE'
            ? {
                approvedById: user.id,
                approvedAt: new Date(),
                calculationHash: hash,
                approvalInvalidatedAt: null,
                approvalInvalidatedReason: null,
                rejectionReason: null,
                selfApproved: withoutSecondPair,
              }
            : {}),
          ...(action === 'REJECT'
            ? { rejectedById: user.id, rejectedAt: new Date(), rejectionReason: reason ?? null }
            : {}),
          ...(action === 'RETURN'
            ? {
                approvedById: null,
                approvedAt: null,
                approvalInvalidatedAt: new Date(),
                approvalInvalidatedReason: reason ?? null,
              }
            : {}),
        },
      })

      await tx.auditLog.create({
        data: {
          companyId: user.companyId,
          userId: user.id,
          userEmailSnapshot: user.email,
          action: `PAYROLL_${action}`,
          entityType: 'WorkerPayroll',
          entityId: payroll.id,
          payrollWeekId: payroll.payrollWeekId,
          oldValueJson: { status: payroll.status, net: payroll.netPay.toFixed(2) },
          newValueJson: { status: next, net: payroll.netPay.toFixed(2) },
          changedFields: ['status'],
          reason: withoutSecondPair
            ? `${reason ?? ''} · SIN SEGUNDO PAR DE OJOS: la misma persona hizo el paso anterior`.trim()
            : (reason ?? null),
        },
      })
    })

    result.moved += 1
  }

  return result
}

export { LABELS }
