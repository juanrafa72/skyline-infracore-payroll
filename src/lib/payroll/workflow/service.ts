import { prisma } from '@/lib/db/client'
import type { CurrentUser } from '@/lib/auth/rbac'
import { detachFromOrder } from '@/lib/disbursement/detach'
import { LABELS, approvalIsStale, type WorkflowAction } from './index'
import { applyPayableTransition, buildMaterialFields, currentHash } from './payables'

/**
 * Ejecuta transiciones de nómina contra la base de datos.
 *
 * Todo lo que decide está en `./index.ts`, que es puro y se prueba solo. El
 * motor que lo aplica a las tres clases de pagable (persona, cuadrilla,
 * equipo) vive en `./payables.ts` — este archivo conserva la puerta de
 * siempre para las nóminas de personas, con su misma firma, para que nada de
 * lo existente tenga que cambiar.
 */

export { buildMaterialFields, currentHash }

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

/**
 * Aplica una acción del flujo a un conjunto de nóminas de PERSONAS.
 *
 * Es la misma firma de siempre: por dentro corre el motor genérico de
 * `payables.ts` con el delegado de personas. Para cuadrillas y equipos se usa
 * `applyPayableTransition` directamente.
 */
export async function applyTransition(
  user: CurrentUser,
  workerPayrollIds: readonly string[],
  action: WorkflowAction,
  reason?: string | null,
): Promise<TransitionResult> {
  const result = await applyPayableTransition(user, 'WORKER', workerPayrollIds, action, reason)
  return {
    moved: result.moved,
    skipped: result.skipped.map((row) => ({ workerName: row.name, reason: row.reason })),
  }
}

export { LABELS }
