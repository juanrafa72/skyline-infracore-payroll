import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import type { CurrentUser } from '@/lib/auth/rbac'
import { canDetach, canDetachPayable, detachFromOrder, detachPayable } from '@/lib/disbursement/detach'
import { toIso } from '@/lib/payroll/week'
import {
  approvalIsStale,
  assertTransition,
  calculationHash,
  crewCalculationHash,
  equipmentCalculationHash,
  isSelfApproval,
  type MaterialFields,
  type PayrollStatus,
  type WorkflowAction,
} from './index'

/**
 * Un solo motor de flujo para los TRES pagables: persona, cuadrilla y equipo.
 *
 * Las reglas —quién puede mover qué, segregación de funciones, empresa
 * receptora obligatoria antes de aprobar (BR-180), sin errores críticos
 * abiertos— viven una sola vez aquí. Cada tipo de pagable aporta un DELEGADO
 * con lo único que de verdad difiere: en qué tabla vive, cómo se llama, cómo
 * se calcula su huella y qué le falta para poder aprobarse.
 *
 * Si estas reglas se copiaran por tabla, tarde o temprano una copia dejaría
 * pasar lo que las otras bloquean — y por ahí se iría la plata.
 */

export type PayableKind = 'WORKER' | 'CREW' | 'EQUIPMENT'

export interface PayableSnapshot {
  id: string
  status: PayrollStatus
  preparedById: string | null
  approvedById: string | null
  paymentRecipientId: string | null
  payrollWeekId: string
  /** Cómo se le dice en mensajes y auditoría. */
  displayName: string
  /** Monto del pagable como cadena con 2 decimales (para auditoría). */
  amount: string
  /** Solo personas: alimenta el campo workerId de las excepciones. */
  workerId?: string
  /**
   * Motivo EXTRA que bloquea APPROVE, además de la receptora: una cuadrilla
   * sin contratista o un equipo rentado sin proveedor no tienen a quién
   * pagarle, y aprobarlos mandaría dinero sin destinatario legal.
   */
  approveBlocker: string | null
}

interface PayableDelegate {
  kind: PayableKind
  entityType: 'WorkerPayroll' | 'CrewPayroll' | 'EquipmentPayroll'
  /** Prefijo de la acción en el registro de auditoría. */
  auditPrefix: string
  load(id: string, companyId: string): Promise<PayableSnapshot | null>
  currentHash(id: string): Promise<string>
  update(tx: Prisma.TransactionClient, id: string, data: Record<string, unknown>): Promise<void>
  canDetach(id: string): Promise<{ ok: boolean; reason?: string }>
  detach(tx: Prisma.TransactionClient, id: string, why: string): Promise<void>
}

// ─────────────────────────────────────────────────────────────
// Persona (WorkerPayroll)
// ─────────────────────────────────────────────────────────────

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
      // Los días de control no pagan: no son materiales para la aprobación.
      isControlOnly: false,
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

const workerDelegate: PayableDelegate = {
  kind: 'WORKER',
  entityType: 'WorkerPayroll',
  auditPrefix: 'PAYROLL',
  async load(id, companyId) {
    const payroll = await prisma.workerPayroll.findFirst({
      where: { id, companyId },
      include: { worker: true },
    })
    if (!payroll) return null
    return {
      id: payroll.id,
      status: payroll.status as PayrollStatus,
      preparedById: payroll.preparedById,
      approvedById: payroll.approvedById,
      paymentRecipientId: payroll.paymentRecipientId,
      payrollWeekId: payroll.payrollWeekId,
      displayName: payroll.worker.displayName,
      amount: payroll.netPay.toFixed(2),
      workerId: payroll.workerId,
      approveBlocker: null,
    }
  },
  currentHash,
  async update(tx, id, data) {
    await tx.workerPayroll.update({ where: { id }, data })
  },
  async canDetach(id) {
    const result = await canDetach(id)
    return result.ok
      ? { ok: true }
      : { ok: false, reason: result.reason ?? 'Ya tiene dinero desembolsado.' }
  },
  async detach(tx, id, why) {
    await detachFromOrder(tx, id, why)
  },
}

// ─────────────────────────────────────────────────────────────
// Cuadrilla (CrewPayroll)
// ─────────────────────────────────────────────────────────────

export async function crewCurrentHash(crewPayrollId: string): Promise<string> {
  const payroll = await prisma.crewPayroll.findUniqueOrThrow({ where: { id: crewPayrollId } })
  const production = await prisma.production.findMany({
    where: {
      companyId: payroll.companyId,
      payrollWeekId: payroll.payrollWeekId,
      crewId: payroll.crewId,
    },
    orderBy: { productionDate: 'asc' },
  })

  return crewCalculationHash({
    crewId: payroll.crewId,
    contractorId: payroll.contractorId,
    production: production.map((row) => ({
      date: toIso(row.productionDate),
      unitCode: row.unitCode,
      quantity: row.quantity.toString(),
      appliedPrice: row.appliedPrice.toString(),
      amount: row.amount.toFixed(2),
    })),
    total: payroll.productionTotal.toFixed(2),
  })
}

const crewDelegate: PayableDelegate = {
  kind: 'CREW',
  entityType: 'CrewPayroll',
  auditPrefix: 'CREW_PAYROLL',
  async load(id, companyId) {
    const payroll = await prisma.crewPayroll.findFirst({ where: { id, companyId } })
    if (!payroll) return null
    return {
      id: payroll.id,
      status: payroll.status as PayrollStatus,
      preparedById: payroll.preparedById,
      approvedById: payroll.approvedById,
      paymentRecipientId: payroll.paymentRecipientId,
      payrollWeekId: payroll.payrollWeekId,
      displayName: `Cuadrilla ${payroll.crewNameSnapshot}`,
      amount: payroll.productionTotal.toFixed(2),
      approveBlocker: payroll.contractorId
        ? null
        : 'La cuadrilla no tiene contratista asignado. A él es a quien se le paga: asígnalo en Cuadrillas antes de aprobar.',
    }
  },
  currentHash: crewCurrentHash,
  async update(tx, id, data) {
    await tx.crewPayroll.update({ where: { id }, data })
  },
  async canDetach(id) {
    const result = await canDetachPayable({ kind: 'CREW', payableId: id })
    return result.ok
      ? { ok: true }
      : { ok: false, reason: result.reason ?? 'Ya tiene dinero desembolsado.' }
  },
  async detach(tx, id, why) {
    await detachPayable(tx, { kind: 'CREW', payableId: id }, why)
  },
}

// ─────────────────────────────────────────────────────────────
// Equipo rentado (EquipmentPayroll)
// ─────────────────────────────────────────────────────────────

export async function equipmentCurrentHash(equipmentPayrollId: string): Promise<string> {
  const payroll = await prisma.equipmentPayroll.findUniqueOrThrow({
    where: { id: equipmentPayrollId },
  })
  const entries = await prisma.equipmentEntry.findMany({
    where: {
      companyId: payroll.companyId,
      payrollWeekId: payroll.payrollWeekId,
      equipmentId: payroll.equipmentId,
    },
    orderBy: { workDate: 'asc' },
  })

  return equipmentCalculationHash({
    equipmentId: payroll.equipmentId,
    vendorId: payroll.vendorId,
    days: entries.map((entry) => toIso(entry.workDate)),
    appliedDailyCost: payroll.appliedDailyCost.toFixed(2),
    total: payroll.totalAmount.toFixed(2),
  })
}

const equipmentDelegate: PayableDelegate = {
  kind: 'EQUIPMENT',
  entityType: 'EquipmentPayroll',
  auditPrefix: 'EQUIPMENT_PAYROLL',
  async load(id, companyId) {
    const payroll = await prisma.equipmentPayroll.findFirst({ where: { id, companyId } })
    if (!payroll) return null
    return {
      id: payroll.id,
      status: payroll.status as PayrollStatus,
      preparedById: payroll.preparedById,
      approvedById: payroll.approvedById,
      paymentRecipientId: payroll.paymentRecipientId,
      payrollWeekId: payroll.payrollWeekId,
      displayName: `Equipo ${payroll.equipmentNameSnapshot}`,
      amount: payroll.totalAmount.toFixed(2),
      approveBlocker: payroll.vendorId
        ? null
        : 'El equipo no tiene proveedor asignado. Un equipo jamás recibe pagos (BR-121): el dinero es para quien lo alquila. Asígnale el proveedor antes de aprobar.',
    }
  },
  currentHash: equipmentCurrentHash,
  async update(tx, id, data) {
    await tx.equipmentPayroll.update({ where: { id }, data })
  },
  async canDetach(id) {
    const result = await canDetachPayable({ kind: 'EQUIPMENT', payableId: id })
    return result.ok
      ? { ok: true }
      : { ok: false, reason: result.reason ?? 'Ya tiene dinero desembolsado.' }
  },
  async detach(tx, id, why) {
    await detachPayable(tx, { kind: 'EQUIPMENT', payableId: id }, why)
  },
}

const DELEGATES: Record<PayableKind, PayableDelegate> = {
  WORKER: workerDelegate,
  CREW: crewDelegate,
  EQUIPMENT: equipmentDelegate,
}

// ─────────────────────────────────────────────────────────────
// El motor genérico
// ─────────────────────────────────────────────────────────────

export interface PayableTransitionResult {
  moved: number
  skipped: Array<{ name: string; reason: string }>
}

/** Aplica una acción del flujo a un conjunto de pagables del mismo tipo. */
export async function applyPayableTransition(
  user: CurrentUser,
  kind: PayableKind,
  ids: readonly string[],
  action: WorkflowAction,
  reason?: string | null,
): Promise<PayableTransitionResult> {
  const delegate = DELEGATES[kind]
  const result: PayableTransitionResult = { moved: 0, skipped: [] }

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

  for (const id of ids) {
    const payable = await delegate.load(id, user.companyId)
    if (!payable) continue

    let next: PayrollStatus
    try {
      next = assertTransition({
        action,
        current: payable.status,
        actorId: user.id,
        permissions: user.permissions,
        preparedById: payable.preparedById,
        approvedById: payable.approvedById,
        reason: reason ?? null,
        allowSelfApproval,
      })
    } catch (error) {
      result.skipped.push({ name: payable.displayName, reason: (error as Error).message })
      continue
    }

    /*
     * Aprobar es decidir a dónde va el dinero, no solo cuánto.
     *
     * Sin empresa receptora asignada no se puede saber a quién transferirle, y
     * un pagable aprobado así llegaría a tesorería sin destino. Se bloquea
     * aquí, en el único sitio por donde pasan todas las aprobaciones — BR-180.
     */
    if (action === 'APPROVE' && !payable.paymentRecipientId) {
      result.skipped.push({
        name: payable.displayName,
        reason: 'No tiene empresa receptora asignada. Asígnasela antes de aprobar.',
      })
      continue
    }

    // Lo que a este tipo de pagable le falta para poder aprobarse (contratista
    // de la cuadrilla, proveedor del equipo). Mismo choke point que BR-180.
    if (action === 'APPROVE' && payable.approveBlocker) {
      result.skipped.push({ name: payable.displayName, reason: payable.approveBlocker })
      continue
    }

    // Antes de aprobar se exige que no queden errores críticos abiertos.
    if (action === 'APPROVE') {
      const critical = await prisma.exception.count({
        where: {
          companyId: user.companyId,
          entityId: payable.id,
          level: 'CRITICAL',
          status: 'OPEN',
        },
      })
      if (critical > 0) {
        result.skipped.push({
          name: payable.displayName,
          reason: `Tiene ${critical} error(es) crítico(s) sin resolver.`,
        })
        continue
      }
    }

    /*
     * Devolver un pagable que ya está en una orden de desembolso.
     *
     * Si la orden todavía no ha movido dinero, sale de la orden y el total se
     * recalcula. Si ya movió, no se devuelve: hacerlo dejaría a tesorería con
     * un documento que no corresponde a nadie.
     */
    if (action === 'RETURN') {
      const detachable = await delegate.canDetach(payable.id)
      if (!detachable.ok) {
        result.skipped.push({
          name: payable.displayName,
          reason: detachable.reason ?? 'Ya tiene dinero desembolsado.',
        })
        continue
      }
    }

    const hash = await delegate.currentHash(payable.id)
    const withoutSecondPair = isSelfApproval({
      action,
      current: payable.status,
      actorId: user.id,
      permissions: user.permissions,
      preparedById: payable.preparedById,
      approvedById: payable.approvedById,
    })

    await prisma.$transaction(async (tx) => {
      if (action === 'RETURN') {
        await delegate.detach(tx, payable.id, reason?.trim() || 'devuelta a aprobación')
      }

      await delegate.update(tx, payable.id, {
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
      })

      await tx.auditLog.create({
        data: {
          companyId: user.companyId,
          userId: user.id,
          userEmailSnapshot: user.email,
          action: `${delegate.auditPrefix}_${action}`,
          entityType: delegate.entityType,
          entityId: payable.id,
          payrollWeekId: payable.payrollWeekId,
          oldValueJson: { status: payable.status, net: payable.amount },
          newValueJson: { status: next, net: payable.amount },
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

// ─────────────────────────────────────────────────────────────
// Invalidación: si algo material cambia tras aprobar, la aprobación se cae
// ─────────────────────────────────────────────────────────────

async function invalidatePayableIfStale(
  kind: Exclude<PayableKind, 'WORKER'>,
  id: string,
): Promise<boolean> {
  const delegate = DELEGATES[kind]

  const payable =
    kind === 'CREW'
      ? await prisma.crewPayroll.findUniqueOrThrow({ where: { id } })
      : await prisma.equipmentPayroll.findUniqueOrThrow({ where: { id } })

  if (!['APPROVED', 'READY_TO_PAY'].includes(payable.status)) return false

  const hash = await delegate.currentHash(id)
  if (!approvalIsStale(payable.calculationHash, hash)) return false

  const name =
    kind === 'CREW'
      ? (payable as { crewNameSnapshot: string }).crewNameSnapshot
      : (payable as { equipmentNameSnapshot: string }).equipmentNameSnapshot

  await prisma.$transaction(async (tx) => {
    await delegate.detach(tx, id, 'cambió algo después de aprobar')

    await delegate.update(tx, id, {
      status: 'PENDING_APPROVAL',
      approvedById: null,
      approvedAt: null,
      approvalInvalidatedAt: new Date(),
      approvalInvalidatedReason: 'Cambió algo después de aprobar',
      calculationHash: hash,
    })

    await tx.exception.create({
      data: {
        companyId: payable.companyId,
        code: 'CHANGED_AFTER_APPROVAL',
        level: 'CRITICAL',
        entityType: delegate.entityType,
        entityId: id,
        payrollWeekId: payable.payrollWeekId,
        title: 'Cambió después de aprobar',
        detail:
          `Se modificó algo que afecta el pago de ${name} después de la aprobación. ` +
          'Volvió a esperar aprobación y debe revisarse de nuevo.',
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: payable.companyId,
        action: 'APPROVAL_INVALIDATED',
        entityType: delegate.entityType,
        entityId: id,
        payrollWeekId: payable.payrollWeekId,
        oldValueJson: { status: payable.status, hash: payable.calculationHash },
        newValueJson: { status: 'PENDING_APPROVAL', hash },
        changedFields: ['status', 'calculationHash'],
        reason: 'Cambió algo material después de aprobar',
      },
    })
  })

  return true
}

export async function invalidateCrewIfStale(crewPayrollId: string): Promise<boolean> {
  return invalidatePayableIfStale('CREW', crewPayrollId)
}

export async function invalidateEquipmentIfStale(equipmentPayrollId: string): Promise<boolean> {
  return invalidatePayableIfStale('EQUIPMENT', equipmentPayrollId)
}
