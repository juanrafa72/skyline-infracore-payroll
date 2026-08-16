'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertCan, requireUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import {
  attachDocument,
  cancelOrder,
  generateOrders,
  markSentToAccounting,
  payOrder,
} from '@/lib/disbursement/orders'
import { applyTransition } from '@/lib/payroll/workflow/service'
import { enviarDesprendible } from '@/lib/mail/dispatch-service'
import { applyPayableTransition } from '@/lib/payroll/workflow/payables'

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
  revalidatePath('/approvals')
  revalidatePath('/payroll')
  revalidatePath('/inicio')
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

  const selected = formData.getAll('itemId').map(String).filter(Boolean)

  const result = await payOrder(user, {
    orderId: parsed.data.orderId,
    paymentDate: parsed.data.paymentDate,
    method: parsed.data.method,
    bankName: parsed.data.bankName ?? null,
    reference: parsed.data.reference,
    amountPaid: parsed.data.amountPaid,
    notes: parsed.data.notes ?? null,
    differenceReason: parsed.data.differenceReason ?? null,
    itemIds: selected,
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

/**
 * Tesorería devuelve renglones a aprobación.
 *
 * Es la salida cuando algo está mal: el renglón sale de la orden, el total se
 * recalcula y la liquidación vuelve a la mesa de quien aprueba con el motivo
 * escrito. Si la orden ya movió dinero, el motor lo impide — devolver algo
 * pagado dejaría un documento que no corresponde a nadie (BR-191).
 *
 * Sirve para los tres pagables. Antes solo existía para personas, y en otra
 * pantalla.
 */
export async function returnItemsAction(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await requireUser()
  const itemIds = formData.getAll('itemId').map(String).filter(Boolean)
  const reason = String(formData.get('returnReason') ?? '').trim()

  if (itemIds.length === 0) return 'No marcaste ningún renglón para devolver.'
  if (!reason) return 'Escribe por qué lo devuelves: quien aprueba necesita saberlo.'

  const items = await prisma.disbursementOrderItem.findMany({
    where: { id: { in: itemIds }, companyId: user.companyId },
    select: { workerPayrollId: true, crewPayrollId: true, equipmentPayrollId: true },
  })
  if (items.length === 0) return 'Esos renglones ya no están en la orden.'

  const workerIds = items.flatMap((item) => (item.workerPayrollId ? [item.workerPayrollId] : []))
  const crewIds = items.flatMap((item) => (item.crewPayrollId ? [item.crewPayrollId] : []))
  const equipmentIds = items.flatMap((item) =>
    item.equipmentPayrollId ? [item.equipmentPayrollId] : [],
  )

  let moved = 0
  const skipped: string[] = []

  if (workerIds.length > 0) {
    const result = await applyTransition(user, workerIds, 'RETURN', reason)
    moved += result.moved
    skipped.push(...result.skipped.map((row) => `${row.workerName}: ${row.reason}`))
  }
  for (const [kind, ids] of [
    ['CREW', crewIds],
    ['EQUIPMENT', equipmentIds],
  ] as const) {
    if (ids.length === 0) continue
    const result = await applyPayableTransition(user, kind, ids, 'RETURN', reason)
    moved += result.moved
    skipped.push(...result.skipped.map((row) => `${row.name}: ${row.reason}`))
  }

  revalidateAll()

  if (moved === 0) return skipped[0] ?? 'No se pudo devolver.'
  const detail = skipped.length > 0 ? ` No se pudo con: ${skipped.join(' · ')}` : ''
  return `${skipped.length > 0 ? 'PARCIAL' : 'LISTO'}|${moved} renglón(es) devuelto(s) a aprobación.${detail}`
}

/**
 * Agrupa en órdenes lo que quedó aprobado sin orden.
 *
 * Normalmente las órdenes nacen solas al aprobar. Si alguna vez algo queda por
 * fuera —una aprobación vieja, un reparto que no cuadró— aquí se recupera, en
 * vez de dejar plata aprobada que nadie ve.
 *
 * Lo hace quien aprueba, no tesorería: agrupar es la última parte del acto de
 * aprobar. Quien paga no decide a qué empresa receptora va nada.
 */
// No recibe nada: agrupa TODO lo aprobado que se quedó sin orden.
export async function generateMissingOrdersAction(): Promise<string> {
  const user = await assertCan('payroll:approve')

  const [workers, crews, equipment] = await Promise.all([
    prisma.workerPayroll.findMany({
      where: {
        companyId: user.companyId,
        status: { in: ['APPROVED', 'READY_TO_PAY'] },
        disbursementItem: null,
      },
      select: { id: true },
    }),
    prisma.crewPayroll.findMany({
      where: {
        companyId: user.companyId,
        status: { in: ['APPROVED', 'READY_TO_PAY'] },
        disbursementItem: null,
      },
      select: { id: true },
    }),
    prisma.equipmentPayroll.findMany({
      where: {
        companyId: user.companyId,
        status: { in: ['APPROVED', 'READY_TO_PAY'] },
        disbursementItem: null,
      },
      select: { id: true },
    }),
  ])

  if (workers.length + crews.length + equipment.length === 0) {
    return 'No hay nada aprobado sin orden.'
  }

  const result = await generateOrders(user, {
    workerPayrollIds: workers.map((row) => row.id),
    crewPayrollIds: crews.map((row) => row.id),
    equipmentPayrollIds: equipment.map((row) => row.id),
  })

  revalidateAll()
  return result.ok ? `LISTO|${result.message}` : result.message
}

/**
 * Manda el desprendible de la orden por correo, con su consecutivo.
 *
 * Va a quien esté configurado en «Envío de reportes»: la auxiliar contable y,
 * si se configuró, la empresa receptora de ESTA orden.
 */
export async function sendOrderReport(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payment:view')

  const result = await enviarDesprendible(user, String(formData.get('orderId') ?? ''))
  revalidatePath('/disbursements')
  revalidatePath('/report-recipients')
  return result.ok ? `LISTO|${result.message}` : result.message
}
