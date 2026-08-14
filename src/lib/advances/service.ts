import type { CurrentUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { type Cents, ZERO, toCents, toDecimalString } from '@/lib/payroll/engine/money'
import {
  balanceOf,
  progressOf,
  statusFor,
  totalRecovered,
  type AdvanceStatus,
  type BeneficiaryType,
  type RecoveryMethod,
} from './index'

/**
 * Préstamos contra la base de datos.
 *
 * Lo que decide vive en `./index.ts`, que es puro. Aquí solo se leen datos, se
 * aplica esa decisión y se deja rastro. Los errores de uso vuelven como
 * mensaje; nada lanza.
 */

export interface AdvanceResult {
  ok: boolean
  message: string
  advanceId?: string
}

export interface NewAdvance {
  beneficiaryType: BeneficiaryType
  beneficiaryId: string
  amount: string
  reason: string
  requestDate: string
  recoveryMethod: RecoveryMethod
  recoveryAmount?: string | null
  recoveryPct?: string | null
  recoveryCap?: string | null
  notes?: string | null
}

/** El campo donde va el beneficiario, según su tipo. */
function beneficiaryField(type: BeneficiaryType): 'workerId' | 'contractorId' | 'crewId' | 'recipientId' {
  return {
    WORKER: 'workerId' as const,
    CONTRACTOR: 'contractorId' as const,
    CREW: 'crewId' as const,
    RECIPIENT: 'recipientId' as const,
  }[type]
}

/** Que el beneficiario exista y sea de esta compañía. */
async function beneficiaryName(
  companyId: string,
  type: BeneficiaryType,
  id: string,
): Promise<string | null> {
  const where = { id, companyId }
  if (type === 'WORKER') {
    return (await prisma.worker.findFirst({ where }))?.displayName ?? null
  }
  if (type === 'CONTRACTOR') {
    return (await prisma.contractor.findFirst({ where }))?.name ?? null
  }
  if (type === 'CREW') {
    return (await prisma.crew.findFirst({ where }))?.name ?? null
  }
  return (await prisma.paymentRecipient.findFirst({ where }))?.name ?? null
}

export async function createAdvance(
  user: CurrentUser,
  input: NewAdvance,
): Promise<AdvanceResult> {
  const reason = input.reason.trim()
  if (!reason) {
    return { ok: false, message: 'Escribe para qué es el préstamo. Sin motivo no se guarda.' }
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

  const name = await beneficiaryName(user.companyId, input.beneficiaryType, input.beneficiaryId)
  if (!name) {
    return { ok: false, message: 'Ese beneficiario no existe en esta compañía.' }
  }

  // El plan tiene que estar completo, o el descuento no se podría calcular.
  if (input.recoveryMethod === 'FIXED_WEEKLY' && !input.recoveryAmount?.trim()) {
    return { ok: false, message: 'Con monto fijo hay que decir cuánto se descuenta cada período.' }
  }
  if (
    (input.recoveryMethod === 'PERCENTAGE_OF_NET' ||
      input.recoveryMethod === 'PERCENTAGE_WITH_CAP') &&
    !input.recoveryPct?.trim()
  ) {
    return { ok: false, message: 'Con porcentaje hay que decir qué porcentaje del neto se descuenta.' }
  }

  const advance = await prisma.advance.create({
    data: {
      companyId: user.companyId,
      beneficiaryType: input.beneficiaryType,
      [beneficiaryField(input.beneficiaryType)]: input.beneficiaryId,
      requestDate: new Date(`${input.requestDate}T00:00:00Z`),
      amount: toDecimalString(amount),
      reason,
      recoveryMethod: input.recoveryMethod,
      recoveryAmount: input.recoveryAmount?.trim() || null,
      recoveryPct: input.recoveryPct?.trim() || null,
      recoveryCap: input.recoveryCap?.trim() || null,
      notes: input.notes?.trim() || null,
      status: 'PENDING',
      requestedById: user.id,
    },
  })

  await prisma.auditLog.create({
    data: {
      companyId: user.companyId,
      userId: user.id,
      userEmailSnapshot: user.email,
      action: 'ADVANCE_CREATED',
      entityType: 'Advance',
      entityId: advance.id,
      newValueJson: {
        beneficiary: name,
        amount: toDecimalString(amount),
        method: input.recoveryMethod,
      },
      changedFields: ['amount', 'reason'],
      reason,
    },
  })

  return {
    ok: true,
    message: `Préstamo de $${toDecimalString(amount)} a ${name}. Falta aprobarlo para que empiece a descontarse.`,
    advanceId: advance.id,
  }
}

/**
 * Aprueba un préstamo.
 *
 * Quien aprueba tiene que ser distinto de quien lo pidió — BR-084. Es la misma
 * regla que rige la nómina: nadie se aprueba su propia plata.
 */
export async function approveAdvance(user: CurrentUser, advanceId: string): Promise<AdvanceResult> {
  const advance = await prisma.advance.findFirst({
    where: { id: advanceId, companyId: user.companyId },
  })
  if (!advance) return { ok: false, message: 'Ese préstamo no existe.' }
  if (advance.status !== 'PENDING') {
    return { ok: false, message: 'Ese préstamo ya no está esperando aprobación.' }
  }
  if (advance.requestedById === user.id) {
    return {
      ok: false,
      message: 'No puedes aprobar un préstamo que tú mismo pediste. Debe hacerlo otra persona.',
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.advance.update({
      where: { id: advanceId },
      data: { status: 'ACTIVE', approvedById: user.id, approvedAt: new Date() },
    })
    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'ADVANCE_APPROVED',
        entityType: 'Advance',
        entityId: advanceId,
        oldValueJson: { status: advance.status },
        newValueJson: { status: 'ACTIVE', amount: advance.amount.toFixed(2) },
        changedFields: ['status'],
      },
    })
  })

  return { ok: true, message: `Préstamo aprobado. Ya se puede empezar a descontar.` }
}

export async function cancelAdvance(
  user: CurrentUser,
  advanceId: string,
  reason: string,
): Promise<AdvanceResult> {
  if (!reason.trim()) return { ok: false, message: 'Escribe por qué se anula.' }

  const advance = await prisma.advance.findFirst({
    where: { id: advanceId, companyId: user.companyId },
    include: { recoveries: true },
  })
  if (!advance) return { ok: false, message: 'Ese préstamo no existe.' }
  if (advance.recoveries.length > 0) {
    return {
      ok: false,
      message: `Ya tiene ${advance.recoveries.length} descuento(s) aplicados. No se anula: la plata ya se movió.`,
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.advance.update({ where: { id: advanceId }, data: { status: 'CANCELLED' } })
    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'ADVANCE_CANCELLED',
        entityType: 'Advance',
        entityId: advanceId,
        oldValueJson: { status: advance.status },
        newValueJson: { status: 'CANCELLED' },
        changedFields: ['status'],
        reason: reason.trim(),
      },
    })
  })

  return { ok: true, message: 'Préstamo anulado. El motivo quedó registrado.' }
}

/**
 * Registra un abono hecho por fuera de la nómina.
 *
 * Los descuentos de nómina los genera el motor; esto es para cuando alguien
 * devuelve la plata en efectivo o por transferencia.
 */
export async function recordRepayment(
  user: CurrentUser,
  advanceId: string,
  amountRaw: string,
  notes: string | null,
): Promise<AdvanceResult> {
  const advance = await prisma.advance.findFirst({
    where: { id: advanceId, companyId: user.companyId },
    include: { recoveries: true },
  })
  if (!advance) return { ok: false, message: 'Ese préstamo no existe.' }
  if (advance.status === 'PENDING') {
    return { ok: false, message: 'Todavía no está aprobado: no se le pueden registrar abonos.' }
  }
  if (advance.status === 'CANCELLED') {
    return { ok: false, message: 'Ese préstamo está anulado.' }
  }

  let amount: Cents
  try {
    amount = toCents(amountRaw)
  } catch {
    return { ok: false, message: 'El abono va con máximo 2 decimales.' }
  }
  if (amount <= ZERO) return { ok: false, message: 'El abono tiene que ser mayor que cero.' }

  const recovered = totalRecovered(
    advance.recoveries.map((row) => toCents(row.amount.toFixed(2))),
  )
  const balance = balanceOf({ amount: toCents(advance.amount.toFixed(2)), recovered })

  if (amount > balance) {
    return {
      ok: false,
      message: `Solo quedan $${toDecimalString(balance)} por pagar. No se puede abonar $${toDecimalString(amount)}.`,
    }
  }

  const next = statusFor({
    amount: toCents(advance.amount.toFixed(2)),
    recovered: (recovered + amount) as Cents,
    status: advance.status as AdvanceStatus,
  })

  await prisma.$transaction(async (tx) => {
    await tx.advanceRecovery.create({
      data: {
        advanceId,
        companyId: user.companyId,
        amount: toDecimalString(amount),
        createdById: user.id,
        notes: notes?.trim() || 'Abono registrado a mano',
      },
    })
    await tx.advance.update({ where: { id: advanceId }, data: { status: next } })
    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'ADVANCE_REPAYMENT',
        entityType: 'Advance',
        entityId: advanceId,
        oldValueJson: { recovered: toDecimalString(recovered), status: advance.status },
        newValueJson: {
          recovered: toDecimalString((recovered + amount) as Cents),
          status: next,
        },
        changedFields: ['recoveries'],
        reason: notes?.trim() || null,
      },
    })
  })

  const left = balanceOf({
    amount: toCents(advance.amount.toFixed(2)),
    recovered: (recovered + amount) as Cents,
  })

  return {
    ok: true,
    message:
      left === ZERO
        ? `Abono de $${toDecimalString(amount)} registrado. El préstamo queda pagado.`
        : `Abono de $${toDecimalString(amount)} registrado. Quedan $${toDecimalString(left)}.`,
  }
}

// ─────────────────────────────────────────────────────────────
// Consulta
// ─────────────────────────────────────────────────────────────

export interface AdvanceRow {
  id: string
  beneficiaryType: BeneficiaryType
  beneficiaryName: string
  amount: string
  recovered: string
  balance: string
  progress: number
  status: AdvanceStatus
  method: RecoveryMethod
  planLabel: string
  reason: string
  requestDate: string
  approved: boolean
  requestedByMe: boolean
  recoveries: ReadonlyArray<{ amount: string; when: string; notes: string | null }>
}

export interface AdvancesSummary {
  rows: readonly AdvanceRow[]
  totalLent: string
  totalOutstanding: string
  awaitingApproval: number
}

/** Todos los préstamos de la compañía, con su saldo derivado. */
export async function listAdvances(user: CurrentUser): Promise<AdvancesSummary> {
  const advances = await prisma.advance.findMany({
    where: { companyId: user.companyId },
    include: {
      worker: { select: { displayName: true } },
      contractor: { select: { name: true } },
      crew: { select: { name: true } },
      recipient: { select: { name: true } },
      recoveries: { orderBy: { recoveredAt: 'desc' } },
    },
    orderBy: [{ status: 'asc' }, { requestDate: 'desc' }],
  })

  let totalLent = ZERO
  let totalOutstanding = ZERO
  let awaitingApproval = 0

  const rows = advances.map((advance) => {
    const amount = toCents(advance.amount.toFixed(2))
    const recovered = totalRecovered(
      advance.recoveries.map((row) => toCents(row.amount.toFixed(2))),
    )
    const balance = balanceOf({ amount, recovered })

    if (advance.status !== 'CANCELLED') {
      totalLent = (totalLent + amount) as Cents
      totalOutstanding = (totalOutstanding + balance) as Cents
    }
    if (advance.status === 'PENDING') awaitingApproval += 1

    const plan =
      advance.recoveryMethod === 'FIXED_WEEKLY'
        ? `$${Number(advance.recoveryAmount ?? 0).toFixed(2)} por período`
        : advance.recoveryMethod === 'PERCENTAGE_OF_NET'
          ? `${Number(advance.recoveryPct ?? 0)}% del neto`
          : advance.recoveryMethod === 'PERCENTAGE_WITH_CAP'
            ? `${Number(advance.recoveryPct ?? 0)}% del neto, tope $${Number(advance.recoveryCap ?? 0).toFixed(2)}`
            : advance.recoveryMethod === 'LUMP_SUM'
              ? 'todo de una vez'
              : 'se decide cada vez'

    return {
      id: advance.id,
      beneficiaryType: advance.beneficiaryType as BeneficiaryType,
      beneficiaryName:
        advance.worker?.displayName ??
        advance.contractor?.name ??
        advance.crew?.name ??
        advance.recipient?.name ??
        'sin beneficiario',
      amount: advance.amount.toFixed(2),
      recovered: toDecimalString(recovered),
      balance: toDecimalString(balance),
      progress: progressOf({ amount, recovered }),
      status: advance.status as AdvanceStatus,
      method: advance.recoveryMethod as RecoveryMethod,
      planLabel: plan,
      reason: advance.reason,
      requestDate: advance.requestDate.toISOString().slice(0, 10),
      approved: advance.approvedById !== null,
      requestedByMe: advance.requestedById === user.id,
      recoveries: advance.recoveries.map((row) => ({
        amount: row.amount.toFixed(2),
        when: row.recoveredAt.toISOString().slice(0, 10),
        notes: row.notes,
      })),
    }
  })

  return {
    rows,
    totalLent: toDecimalString(totalLent),
    totalOutstanding: toDecimalString(totalOutstanding),
    awaitingApproval,
  }
}
