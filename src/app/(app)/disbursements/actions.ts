'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertCan, requireUser } from '@/lib/auth/rbac'
import {
  attachDocument,
  cancelOrder,
  markSentToAccounting,
  payOrder,
} from '@/lib/disbursement/orders'

/**
 * Acciones de las órdenes de desembolso.
 *
 * Todas devuelven un mensaje. Ninguna lanza: una excepción en una Server Action
 * se le muestra a tesorería como una pantalla rota, justo cuando está moviendo
 * dinero y necesita entender qué pasó.
 */

const MONEY = /^\d+(\.\d{1,2})?$/

function revalidateAll(): void {
  revalidatePath('/disbursements')
  revalidatePath('/payments')
  revalidatePath('/payroll')
}

export async function payOrderAction(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await requireUser()

  const parsed = z
    .object({
      orderId: z.string().min(1),
      paymentDate: z.string().min(1, 'Falta la fecha en que se transfirió'),
      method: z.enum(['ZELLE', 'ACH', 'WIRE', 'CHECK', 'CASH', 'OTHER']),
      bankName: z.string().trim().optional(),
      reference: z.string().trim().min(1, 'La referencia bancaria es obligatoria'),
      amountPaid: z.string().regex(MONEY, 'El monto va con máximo 2 decimales'),
      notes: z.string().trim().optional(),
      differenceReason: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(formData))

  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Faltan datos del pago.'

  const selected = formData.getAll('workerPayrollId').map(String).filter(Boolean)

  const result = await payOrder(user, {
    orderId: parsed.data.orderId,
    paymentDate: parsed.data.paymentDate,
    method: parsed.data.method,
    bankName: parsed.data.bankName ?? null,
    reference: parsed.data.reference,
    amountPaid: parsed.data.amountPaid,
    notes: parsed.data.notes ?? null,
    differenceReason: parsed.data.differenceReason ?? null,
    workerPayrollIds: selected,
  })

  revalidateAll()
  return result.ok ? `LISTO|${result.message}` : result.message
}

export async function cancelOrderAction(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payroll:approve')
  const orderId = String(formData.get('orderId') ?? '')
  const reason = String(formData.get('reason') ?? '')

  const result = await cancelOrder(user, orderId, reason)
  revalidateAll()
  return result.ok ? `LISTO|${result.message}` : result.message
}

export async function attachProofAction(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payment:proof:upload')
  const orderId = String(formData.get('orderId') ?? '')

  const result = await attachDocument(user, orderId, {
    kind: 'PAYMENT_PROOF',
    fileName: String(formData.get('fileName') ?? ''),
    fileRef: String(formData.get('fileRef') ?? ''),
    notes: String(formData.get('notes') ?? ''),
  })

  revalidateAll()
  return result.ok ? `LISTO|${result.message}` : result.message
}

export async function sendToAccountingAction(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await requireUser()
  const orderId = String(formData.get('orderId') ?? '')
  const sentTo = String(formData.get('sentTo') ?? '')

  const result = await markSentToAccounting(user, orderId, sentTo)
  revalidateAll()
  return result.ok ? `LISTO|${result.message}` : result.message
}
