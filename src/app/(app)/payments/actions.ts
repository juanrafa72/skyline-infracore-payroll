'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { applyTransition } from '@/lib/payroll/workflow/service'

const MONEY = /^\d+(\.\d{1,2})?$/

/**
 * Registra el pago de una nómina aprobada.
 *
 * Lo que tesorería NO puede tocar: días, tarifa, bruto, descuentos, adicionales
 * ni neto. Esos campos ni se envían ni se leen aquí. Si algo está mal, se
 * devuelve la nómina con el motivo.
 */
export async function payPayroll(_previous: string | null, formData: FormData): Promise<string> {
  const user = await requireUser()

  const parsed = z
    .object({
      payrollId: z.string().min(1),
      paymentDate: z.string().min(1, 'Falta la fecha de pago'),
      method: z.enum(['ZELLE', 'ACH', 'WIRE', 'CHECK', 'CASH', 'OTHER']),
      amountPaid: z.string().regex(MONEY, 'Monto con máximo 2 decimales'),
      reference: z.string().trim().min(1, 'La referencia es obligatoria'),
      notes: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(formData))

  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Datos inválidos'

  const payroll = await prisma.workerPayroll.findFirst({
    where: { id: parsed.data.payrollId, companyId: user.companyId },
    include: { worker: true, payrollWeek: true },
  })
  if (!payroll) return 'Nómina no encontrada.'

  const approved = Number(payroll.netPay)
  const paying = Number(parsed.data.amountPaid)

  // Pagar de más está bloqueado; pagar de menos se permite pero deja diferencia.
  if (paying > approved) {
    return `No se puede pagar $${paying.toFixed(2)}: lo aprobado es $${approved.toFixed(2)}. Si el monto correcto es otro, devuelve la nómina para que se apruebe de nuevo.`
  }

  const duplicate = await prisma.payment.findFirst({
    where: { companyId: user.companyId, reference: parsed.data.reference },
    include: { worker: true },
  })
  if (duplicate) {
    return `Esa referencia ya se usó en el pago ${duplicate.paymentNumber}${
      duplicate.worker ? ` de ${duplicate.worker.displayName}` : ''
    }. Verifica que no sea un pago repetido.`
  }

  // Primero la transición: si tesorería no puede pagar esto, no se crea nada.
  const started = await applyTransition(user, [payroll.id], 'START_PAYMENT', null)
  if (started.moved === 0) {
    return started.skipped[0]?.reason ?? 'No se pudo iniciar el pago.'
  }

  const count = await prisma.payment.count({ where: { companyId: user.companyId } })
  const paymentNumber = `PAY-${String(count + 1).padStart(5, '0')}`

  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        companyId: user.companyId,
        paymentNumber,
        payeeType: 'WORKER',
        workerId: payroll.workerId,
        payrollWeekId: payroll.payrollWeekId,
        approvedAmount: payroll.netPay,
        amountPaid: parsed.data.amountPaid,
        paymentDate: new Date(`${parsed.data.paymentDate}T00:00:00Z`),
        method: parsed.data.method,
        reference: parsed.data.reference,
        notes: parsed.data.notes || null,
        status: 'PAID',
        paidById: user.id,
        paidAt: new Date(),
        bankAccountLast4: payroll.worker.bankAccountLast4,
      },
    })

    await tx.workerPayroll.update({
      where: { id: payroll.id },
      data: { paymentId: payment.id },
    })

    // Pagar menos de lo aprobado no se oculta: queda como diferencia abierta.
    if (paying < approved) {
      await tx.variance.create({
        data: {
          companyId: user.companyId,
          context: `Pago ${paymentNumber} de ${payroll.worker.displayName}`,
          sourceAName: 'Aprobado',
          sourceAAmount: payroll.netPay,
          sourceBName: 'Pagado',
          sourceBAmount: parsed.data.amountPaid,
          difference: (approved - paying).toFixed(2),
          payrollWeekId: payroll.payrollWeekId,
          entityType: 'Payment',
          entityId: payment.id,
        },
      })
    }

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'PAYMENT_EXECUTED',
        entityType: 'Payment',
        entityId: payment.id,
        payrollWeekId: payroll.payrollWeekId,
        newValueJson: {
          paymentNumber,
          worker: payroll.worker.displayName,
          approved: approved.toFixed(2),
          paid: paying.toFixed(2),
          method: parsed.data.method,
          reference: parsed.data.reference,
        },
        changedFields: ['amountPaid', 'status'],
        reason: parsed.data.notes || null,
      },
    })
  })

  // Se confirma el pago como paso aparte, para que quede registrado el momento.
  await applyTransition(user, [payroll.id], 'CONFIRM_PAYMENT', null)

  revalidatePath('/payments')
  return `LISTO|${paymentNumber} · ${payroll.worker.displayName} · $${paying.toFixed(2)}${
    paying < approved ? ` (quedó una diferencia de $${(approved - paying).toFixed(2)})` : ''
  }`
}

/** Tesorería devuelve una nómina cuando encuentra un error. */
export async function returnToApproval(_previous: string | null, formData: FormData): Promise<string> {
  const user = await requireUser()
  const ids = formData.getAll('payrollId').map(String).filter(Boolean)
  const reason = String(formData.get('reason') ?? '').trim()

  if (ids.length === 0) return 'No marcaste ninguna nómina.'
  if (!reason) return 'Escribe por qué la devuelves: quien aprueba necesita saberlo.'

  const result = await applyTransition(user, ids, 'RETURN', reason)
  revalidatePath('/payments')
  revalidatePath('/approvals')

  if (result.moved === 0) {
    return result.skipped[0]?.reason ?? 'No se pudo devolver.'
  }
  return `LISTO|${result.moved} nómina(s) devuelta(s) a aprobación.`
}
