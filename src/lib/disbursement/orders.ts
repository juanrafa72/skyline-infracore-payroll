import type { CurrentUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { type Cents, ZERO, add, toCents, toDecimalString } from '@/lib/payroll/engine/money'
import { applyTransition } from '@/lib/payroll/workflow/service'
import { checkBalance, groupByRecipient, type PayrollToGroup } from './grouping'
import { formatOrderNumber, nextNumber } from './sequence'

/**
 * Órdenes de desembolso.
 *
 * Una orden es una instrucción de transferencia: cuánto dinero sale, a qué
 * empresa receptora, por qué trabajadores y de qué semana. Se crean solas al
 * aprobar, agrupando por (semana + empresa receptora).
 *
 * Igual que el resto de servicios, los errores de uso vuelven como mensaje.
 */

export interface OrderResult {
  ok: boolean
  message: string
  orderNumbers?: readonly string[]
}

/** Estados en los que todavía se puede decidir a dónde va el dinero. */
const ASSIGNABLE = ['DRAFT', 'PREPARED', 'REJECTED', 'PENDING_APPROVAL'] as const

// ─────────────────────────────────────────────────────────────
// Asignar empresa receptora
// ─────────────────────────────────────────────────────────────

export interface AssignResult {
  ok: boolean
  message: string
  assigned: number
}

/**
 * Asigna la empresa receptora a una o varias nóminas.
 *
 * Sirve igual para una persona que para cincuenta: es la misma operación. Lo
 * que no se puede es reasignar algo ya aprobado — ahí ya existe una orden de
 * desembolso, y cambiarla por debajo dejaría el documento diciendo una cosa y
 * la base otra. Para eso se devuelve la nómina, que ya queda registrado.
 */
export async function assignRecipient(
  user: CurrentUser,
  workerPayrollIds: readonly string[],
  recipientId: string,
): Promise<AssignResult> {
  if (workerPayrollIds.length === 0) {
    return { ok: false, message: 'No marcaste a nadie.', assigned: 0 }
  }

  const recipient = await prisma.paymentRecipient.findFirst({
    where: { id: recipientId, companyId: user.companyId },
  })
  if (!recipient) {
    return { ok: false, message: 'Esa empresa receptora no existe.', assigned: 0 }
  }
  if (!recipient.active) {
    return {
      ok: false,
      message: `«${recipient.name}» está inactiva. Actívala primero o escoge otra.`,
      assigned: 0,
    }
  }

  const payrolls = await prisma.workerPayroll.findMany({
    where: { id: { in: [...workerPayrollIds] }, companyId: user.companyId },
    include: { worker: true },
  })

  const blocked = payrolls.filter(
    (payroll) => !ASSIGNABLE.includes(payroll.status as (typeof ASSIGNABLE)[number]),
  )
  const assignable = payrolls.filter((payroll) =>
    ASSIGNABLE.includes(payroll.status as (typeof ASSIGNABLE)[number]),
  )

  if (assignable.length === 0) {
    return {
      ok: false,
      message:
        'Ninguna se puede cambiar: ya están aprobadas o pagadas. Si hay que corregir a dónde va el dinero, devuelve la nómina.',
      assigned: 0,
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.workerPayroll.updateMany({
      where: { id: { in: assignable.map((payroll) => payroll.id) } },
      data: {
        paymentRecipientId: recipientId,
        recipientAssignedById: user.id,
        recipientAssignedAt: new Date(),
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'RECIPIENT_ASSIGNED',
        entityType: 'WorkerPayroll',
        entityId: assignable[0]!.id,
        payrollWeekId: assignable[0]!.payrollWeekId,
        newValueJson: {
          recipient: recipient.name,
          recipientId,
          workers: assignable.map((payroll) => payroll.worker.displayName),
        },
        changedFields: ['paymentRecipientId'],
        reason: `Empresa receptora «${recipient.name}» asignada a ${assignable.length} persona(s)`,
      },
    })
  })

  const message =
    blocked.length === 0
      ? `${assignable.length} persona(s) se pagarán con fondos a «${recipient.name}».`
      : `${assignable.length} asignada(s) a «${recipient.name}». ${blocked.length} quedaron fuera: ya están aprobadas o pagadas.`

  return { ok: true, message, assigned: assignable.length }
}

// ─────────────────────────────────────────────────────────────
// Resumen antes de aprobar
// ─────────────────────────────────────────────────────────────

export interface PreviewGroup {
  recipientId: string
  recipientName: string
  payrollWeekId: string
  weekLabel: string
  period: string
  workers: ReadonlyArray<{ name: string; amount: string }>
  total: string
}

export interface ApprovalPreview {
  groups: readonly PreviewGroup[]
  unassigned: ReadonlyArray<{ workerPayrollId: string; workerName: string }>
  grandTotal: string
  balanced: boolean
  balanceMessage: string | null
}

/**
 * Lo que verá quien aprueba antes de confirmar: cuánto sale hacia cada empresa
 * receptora, con nombre y monto de cada persona.
 */
export async function previewApproval(
  companyId: string,
  workerPayrollIds: readonly string[],
): Promise<ApprovalPreview> {
  const payrolls = await prisma.workerPayroll.findMany({
    where: { id: { in: [...workerPayrollIds] }, companyId },
    include: { worker: true, payrollWeek: true, paymentRecipient: true },
  })

  const toGroup: PayrollToGroup[] = payrolls.map((payroll) => ({
    workerPayrollId: payroll.id,
    workerId: payroll.workerId,
    workerName: payroll.worker.displayName,
    payrollWeekId: payroll.payrollWeekId,
    netPay: payroll.netPay.toFixed(2),
    recipientId: payroll.paymentRecipientId,
    recipientName: payroll.paymentRecipient?.name ?? null,
  }))

  const { groups, unassigned, grandTotal } = groupByRecipient(toGroup)

  const approvedTotal = payrolls.reduce<Cents>(
    (accumulator, payroll) => add(accumulator, toCents(payroll.netPay.toFixed(2))),
    ZERO,
  )
  const balance = checkBalance(approvedTotal, groups)

  const weekById = new Map(payrolls.map((payroll) => [payroll.payrollWeekId, payroll.payrollWeek]))

  return {
    groups: groups.map((group) => {
      const week = weekById.get(group.payrollWeekId)
      return {
        recipientId: group.recipientId,
        recipientName: group.recipientName,
        payrollWeekId: group.payrollWeekId,
        weekLabel: week ? `${week.label} · ${week.year}` : '',
        period: week
          ? `${week.startDate.toISOString().slice(0, 10)} → ${week.endDate.toISOString().slice(0, 10)}`
          : '',
        workers: group.items.map((item) => ({
          name: item.workerName,
          amount: toDecimalString(item.amount),
        })),
        total: toDecimalString(group.total),
      }
    }),
    unassigned,
    grandTotal: toDecimalString(grandTotal),
    // Con gente sin asignar nunca cuadra: esa plata no está repartida.
    balanced: balance.balanced && unassigned.length === 0,
    balanceMessage:
      unassigned.length > 0
        ? `${unassigned.length} persona(s) no tienen empresa receptora. Asígnaselas antes de aprobar.`
        : balance.message,
  }
}

// ─────────────────────────────────────────────────────────────
// Generar las órdenes
// ─────────────────────────────────────────────────────────────

/**
 * Crea las órdenes de desembolso de un conjunto de nóminas ya aprobadas.
 *
 * Idempotente: una nómina que ya está en una orden no entra en otra. Si ya hay
 * una orden abierta para esa semana y esa receptora, se le agregan las nuevas;
 * si la que existe ya tiene dinero desembolsado, se crea una nueva con su
 * propio consecutivo, porque lo que ya salió del banco no se toca.
 */
export async function generateOrders(
  user: CurrentUser,
  workerPayrollIds: readonly string[],
): Promise<OrderResult> {
  const payrolls = await prisma.workerPayroll.findMany({
    where: {
      id: { in: [...workerPayrollIds] },
      companyId: user.companyId,
      status: { in: ['APPROVED', 'READY_TO_PAY'] },
      disbursementItem: null,
    },
    include: { worker: true, payrollWeek: true, paymentRecipient: true },
  })

  if (payrolls.length === 0) {
    return { ok: true, message: 'No había nada nuevo por agrupar.', orderNumbers: [] }
  }

  const withoutRecipient = payrolls.filter((payroll) => !payroll.paymentRecipientId)
  if (withoutRecipient.length > 0) {
    return {
      ok: false,
      message: `No se pueden generar las órdenes: ${withoutRecipient
        .map((payroll) => payroll.worker.displayName)
        .join(', ')} no tienen empresa receptora.`,
    }
  }

  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } })

  const { groups } = groupByRecipient(
    payrolls.map((payroll) => ({
      workerPayrollId: payroll.id,
      workerId: payroll.workerId,
      workerName: payroll.worker.displayName,
      payrollWeekId: payroll.payrollWeekId,
      netPay: payroll.netPay.toFixed(2),
      recipientId: payroll.paymentRecipientId,
      recipientName: payroll.paymentRecipient?.name ?? null,
    })),
  )

  const created: string[] = []
  const weekById = new Map(payrolls.map((payroll) => [payroll.payrollWeekId, payroll.payrollWeek]))
  const preparedBy = payrolls.find((payroll) => payroll.preparedById)?.preparedById ?? null
  const preparer = preparedBy
    ? await prisma.user.findUnique({ where: { id: preparedBy }, select: { name: true } })
    : null

  for (const group of groups) {
    const week = weekById.get(group.payrollWeekId)
    if (!week) continue

    const recipient = await prisma.paymentRecipient.findUniqueOrThrow({
      where: { id: group.recipientId },
    })

    await prisma.$transaction(async (tx) => {
      const open = await tx.disbursementOrder.findFirst({
        where: {
          companyId: user.companyId,
          payrollWeekId: group.payrollWeekId,
          recipientId: group.recipientId,
          status: 'PENDING_PAYMENT',
        },
      })

      const items = group.items.map((item) => ({
        companyId: user.companyId,
        workerPayrollId: item.workerPayrollId,
        workerId: item.workerId,
        itemNameSnapshot: item.workerName,
        amount: toDecimalString(item.amount),
      }))

      if (open) {
        await tx.disbursementOrderItem.createMany({
          data: items.map((item) => ({ ...item, disbursementOrderId: open.id })),
        })

        const totals = await tx.disbursementOrderItem.aggregate({
          where: { disbursementOrderId: open.id },
          _sum: { amount: true },
          _count: true,
        })

        await tx.disbursementOrder.update({
          where: { id: open.id },
          data: {
            totalAmount: totals._sum.amount ?? 0,
            itemCount: totals._count,
            approvedById: user.id,
            approvedByName: user.name,
            approvedAt: new Date(),
          },
        })

        created.push(open.orderNumber)
        return
      }

      const year = week.startDate.getUTCFullYear()
      const number = await nextNumber(user.companyId, 'DISBURSEMENT_ORDER', year, tx)
      const orderNumber = formatOrderNumber(company.code, year, number)

      const order = await tx.disbursementOrder.create({
        data: {
          companyId: user.companyId,
          payrollWeekId: group.payrollWeekId,
          recipientId: group.recipientId,
          orderNumber,
          itemCount: group.items.length,
          totalAmount: toDecimalString(group.total),
          companyNameSnapshot: company.displayName,
          recipientNameSnapshot: recipient.name,
          recipientTaxIdSnapshot: recipient.taxId,
          weekLabelSnapshot: `${week.label} · ${week.year}`,
          periodStart: week.startDate,
          periodEnd: week.endDate,
          preparedByName: preparer?.name ?? null,
          approvedById: user.id,
          approvedByName: user.name,
          approvedAt: new Date(),
          createdById: user.id,
          items: { create: items },
        },
      })

      await tx.auditLog.create({
        data: {
          companyId: user.companyId,
          userId: user.id,
          userEmailSnapshot: user.email,
          action: 'DISBURSEMENT_ORDER_CREATED',
          entityType: 'DisbursementOrder',
          entityId: order.id,
          payrollWeekId: group.payrollWeekId,
          newValueJson: {
            orderNumber,
            recipient: recipient.name,
            total: toDecimalString(group.total),
            workers: group.items.map((item) => item.workerName),
          },
          changedFields: ['orderNumber', 'totalAmount'],
          reason: `Orden ${orderNumber} · ${group.items.length} persona(s) · $${toDecimalString(group.total)}`,
        },
      })

      created.push(orderNumber)
    })
  }

  return {
    ok: true,
    message:
      created.length === 1
        ? `Se generó la orden ${created[0]}.`
        : `Se generaron ${created.length} órdenes de desembolso.`,
    orderNumbers: created,
  }
}

// ─────────────────────────────────────────────────────────────
// Registrar el pago
// ─────────────────────────────────────────────────────────────

export interface PayOrderInput {
  orderId: string
  paymentDate: string
  method: 'ZELLE' | 'ACH' | 'WIRE' | 'CHECK' | 'CASH' | 'OTHER'
  bankName?: string | null
  reference: string
  amountPaid: string
  notes?: string | null
  differenceReason?: string | null
  /**
   * A quiénes cubre esta transferencia. Vacío = a todos los que faltan.
   * Sirve cuando el dinero llegó en dos giros.
   */
  workerPayrollIds?: readonly string[]
}

/**
 * Registra la transferencia de una orden.
 *
 * Se crea un pago por trabajador — así se conservan los comprobantes, las
 * diferencias y los ajustes que ya existen por persona — pero todos comparten
 * la referencia bancaria y quedan colgados de la misma orden.
 *
 * La regla dura: **lo transferido tiene que ser exactamente la suma de las
 * personas que se marcaron**. Si no coincide, no se registra nada. Un número
 * que no cuadra con nadie hace imposible saber a quién le llegó.
 */
export async function payOrder(user: CurrentUser, input: PayOrderInput): Promise<OrderResult> {
  const order = await prisma.disbursementOrder.findFirst({
    where: { id: input.orderId, companyId: user.companyId },
    include: {
      items: { include: { workerPayroll: { include: { worker: true } } } },
      recipient: true,
    },
  })

  if (!order) return { ok: false, message: 'Esa orden de desembolso no existe.' }
  if (order.status === 'PAID') {
    return { ok: false, message: `La orden ${order.orderNumber} ya está pagada completa.` }
  }
  if (order.status === 'CANCELLED') {
    return { ok: false, message: `La orden ${order.orderNumber} está anulada.` }
  }

  // Hoy los renglones pagables por aquí son de personas; cuadrillas y equipos
  // se conectan en la fase de órdenes mixtas.
  const pending = order.items.filter(
    (item) =>
      item.workerPayroll !== null &&
      !['PAID', 'RECONCILED', 'CLOSED'].includes(item.workerPayroll.status),
  )
  if (pending.length === 0) {
    return { ok: false, message: 'Todas las personas de esta orden ya están pagadas.' }
  }

  const selectedIds = new Set(
    input.workerPayrollIds && input.workerPayrollIds.length > 0
      ? input.workerPayrollIds
      : pending.map((item) => item.workerPayrollId!),
  )
  const selected = pending.filter((item) => selectedIds.has(item.workerPayrollId!))

  if (selected.length === 0) {
    return { ok: false, message: 'No marcaste a nadie de esta orden.' }
  }

  const expected = selected.reduce<Cents>(
    (accumulator, item) => add(accumulator, toCents(item.amount.toFixed(2))),
    ZERO,
  )
  const paying = toCents(input.amountPaid)

  if (paying !== expected) {
    return {
      ok: false,
      message:
        `Marcaste ${selected.length} persona(s) que suman $${toDecimalString(expected)}, ` +
        `pero escribiste $${toDecimalString(paying)}. ` +
        'Los dos números tienen que coincidir: si transferiste otra cantidad, marca exactamente a quiénes cubre.',
    }
  }

  const partial = selected.length < order.items.length
  if (partial && !input.differenceReason?.trim()) {
    return {
      ok: false,
      message:
        `Esta transferencia cubre ${selected.length} de ${order.items.length} personas. ` +
        'Escribe por qué van aparte: quien revise después necesita saberlo.',
    }
  }

  // Una referencia repetida casi siempre es un pago registrado dos veces.
  const duplicate = await prisma.payment.findFirst({
    where: {
      companyId: user.companyId,
      reference: input.reference.trim(),
      NOT: { disbursementOrderId: order.id },
    },
    include: { disbursementOrder: true },
  })
  if (duplicate) {
    return {
      ok: false,
      message: `Esa referencia ya se usó${
        duplicate.disbursementOrder ? ` en la orden ${duplicate.disbursementOrder.orderNumber}` : ''
      }. Verifica que no sea un pago repetido.`,
    }
  }

  // Primero la transición. Si esta persona no puede pagar esto, no se crea nada.
  const ids = selected.map((item) => item.workerPayrollId!)
  const started = await applyTransition(user, ids, 'START_PAYMENT', null)
  if (started.moved === 0) {
    return { ok: false, message: started.skipped[0]?.reason ?? 'No se pudo iniciar el pago.' }
  }
  if (started.skipped.length > 0) {
    const detail = started.skipped.map((row) => `${row.workerName}: ${row.reason}`).join(' · ')
    return { ok: false, message: `No se registró nada. ${detail}` }
  }

  const count = await prisma.payment.count({ where: { companyId: user.companyId } })
  const now = new Date()
  const paymentDate = new Date(`${input.paymentDate}T00:00:00Z`)
  const reference = input.reference.trim()

  await prisma.$transaction(async (tx) => {
    for (const [index, item] of selected.entries()) {
      const payment = await tx.payment.create({
        data: {
          companyId: user.companyId,
          paymentNumber: `PAY-${String(count + index + 1).padStart(5, '0')}`,
          payeeType: 'WORKER',
          workerId: item.workerId!,
          payrollWeekId: order.payrollWeekId,
          disbursementOrderId: order.id,
          approvedAmount: item.amount,
          amountPaid: item.amount,
          paymentDate,
          method: input.method,
          reference,
          notes: input.notes?.trim() || null,
          status: 'PAID',
          paidById: user.id,
          paidAt: now,
          bankAccountLast4: order.recipient.bankAccountLast4,
        },
      })

      await tx.workerPayroll.update({
        where: { id: item.workerPayrollId! },
        data: { paymentId: payment.id },
      })
    }

    const paidSoFar = add(toCents(order.amountPaid.toFixed(2)), paying)
    const total = toCents(order.totalAmount.toFixed(2))
    const complete = paidSoFar === total

    await tx.disbursementOrder.update({
      where: { id: order.id },
      data: {
        amountPaid: toDecimalString(paidSoFar),
        status: complete ? 'PAID' : 'PARTIALLY_PAID',
        paidById: user.id,
        paidByName: user.name,
        paidAt: now,
        paymentDate,
        method: input.method,
        bankName: input.bankName?.trim() || null,
        reference,
        paymentNotes: input.notes?.trim() || null,
        differenceReason: input.differenceReason?.trim() || order.differenceReason,
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'DISBURSEMENT_PAID',
        entityType: 'DisbursementOrder',
        entityId: order.id,
        payrollWeekId: order.payrollWeekId,
        oldValueJson: { status: order.status, paid: order.amountPaid.toFixed(2) },
        newValueJson: {
          orderNumber: order.orderNumber,
          recipient: order.recipientNameSnapshot,
          status: complete ? 'PAID' : 'PARTIALLY_PAID',
          paid: toDecimalString(paidSoFar),
          reference,
          method: input.method,
          workers: selected.map((item) => item.itemNameSnapshot),
        },
        changedFields: ['status', 'amountPaid', 'reference'],
        reason: input.differenceReason?.trim() || input.notes?.trim() || null,
      },
    })
  })

  await applyTransition(user, ids, 'CONFIRM_PAYMENT', null)

  return {
    ok: true,
    message:
      `${order.orderNumber} · $${toDecimalString(paying)} a «${order.recipientNameSnapshot}» ` +
      `· ${selected.length} persona(s)` +
      (partial ? `. Quedan ${order.items.length - selected.length} por pagar en esta orden.` : '.'),
    orderNumbers: [order.orderNumber],
  }
}

// ─────────────────────────────────────────────────────────────
// Anular, documentar, enviar a contabilidad
// ─────────────────────────────────────────────────────────────

export async function cancelOrder(
  user: CurrentUser,
  orderId: string,
  reason: string,
): Promise<OrderResult> {
  if (!reason.trim()) {
    return { ok: false, message: 'Escribe por qué se anula. Sin motivo no se puede.' }
  }

  const order = await prisma.disbursementOrder.findFirst({
    where: { id: orderId, companyId: user.companyId },
  })
  if (!order) return { ok: false, message: 'Esa orden no existe.' }
  if (order.status !== 'PENDING_PAYMENT') {
    return {
      ok: false,
      message: `La orden ${order.orderNumber} ya tiene dinero desembolsado o está anulada. No se puede anular.`,
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.disbursementOrder.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        cancelledById: user.id,
        cancelledAt: new Date(),
        cancellationReason: reason.trim(),
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'DISBURSEMENT_ORDER_CANCELLED',
        entityType: 'DisbursementOrder',
        entityId: orderId,
        payrollWeekId: order.payrollWeekId,
        oldValueJson: { status: order.status },
        newValueJson: { status: 'CANCELLED' },
        changedFields: ['status'],
        reason: reason.trim(),
      },
    })
  })

  return { ok: true, message: `Orden ${order.orderNumber} anulada. El motivo quedó registrado.` }
}

/**
 * Registra el comprobante de la transferencia.
 *
 * El archivo vive en SharePoint; aquí queda la referencia con la que se ubica.
 * Ver CLAUDE.md, fronteras de proveedores: la base guarda datos, no archivos.
 */
export async function attachDocument(
  user: CurrentUser,
  orderId: string,
  input: { kind: 'PAYMENT_PROOF' | 'ORDER_PDF' | 'OTHER'; fileName: string; fileRef: string; notes?: string | null },
): Promise<OrderResult> {
  const order = await prisma.disbursementOrder.findFirst({
    where: { id: orderId, companyId: user.companyId },
  })
  if (!order) return { ok: false, message: 'Esa orden no existe.' }

  const fileRef = input.fileRef.trim()
  if (!fileRef) {
    return { ok: false, message: 'Falta el enlace del comprobante en SharePoint.' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.disbursementDocument.create({
      data: {
        companyId: user.companyId,
        disbursementOrderId: orderId,
        kind: input.kind,
        fileName: input.fileName.trim() || 'comprobante',
        fileRef,
        notes: input.notes?.trim() || null,
        uploadedById: user.id,
        uploadedByName: user.name,
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'DISBURSEMENT_DOCUMENT_ATTACHED',
        entityType: 'DisbursementOrder',
        entityId: orderId,
        payrollWeekId: order.payrollWeekId,
        newValueJson: { kind: input.kind, fileName: input.fileName, fileRef },
        changedFields: ['documents'],
      },
    })
  })

  return { ok: true, message: 'Comprobante registrado y asociado a la orden.' }
}

/**
 * Deja constancia de que el soporte se le pasó a contabilidad.
 *
 * Todavía no hay envío de correo. Se registra el hecho y a quién, que es lo
 * que después alguien va a necesitar demostrar; conectar el correo no cambia
 * este registro.
 */
export async function markSentToAccounting(
  user: CurrentUser,
  orderId: string,
  sentTo: string,
): Promise<OrderResult> {
  const order = await prisma.disbursementOrder.findFirst({
    where: { id: orderId, companyId: user.companyId },
  })
  if (!order) return { ok: false, message: 'Esa orden no existe.' }

  const destination = sentTo.trim()
  if (!destination) {
    return { ok: false, message: 'Escribe a quién se le envió (correo o nombre).' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.disbursementOrder.update({
      where: { id: orderId },
      data: {
        sentToAccountingAt: new Date(),
        sentToAccountingById: user.id,
        sentToAccountingTo: destination,
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'DISBURSEMENT_SENT_TO_ACCOUNTING',
        entityType: 'DisbursementOrder',
        entityId: orderId,
        payrollWeekId: order.payrollWeekId,
        newValueJson: { orderNumber: order.orderNumber, sentTo: destination },
        changedFields: ['sentToAccountingAt'],
      },
    })
  })

  return { ok: true, message: `${order.orderNumber} marcada como enviada a ${destination}.` }
}
