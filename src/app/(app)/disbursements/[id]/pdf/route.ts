import { assertCan } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { renderDisbursementPdf } from '@/lib/pdf/disbursement'
import { ESTADO_ORDEN, METODO_PAGO, label } from '@/lib/payroll/labels'
import { toIso } from '@/lib/payroll/week'

export const dynamic = 'force-dynamic'

/**
 * Desprendible de una orden de desembolso.
 *
 * Se arma en el momento con lo que hay guardado en la orden — nombres y montos
 * congelados al aprobar — así que el documento de hoy y el de dentro de un año
 * dicen exactamente lo mismo.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await assertCan('payment:view')
  const { id } = await context.params

  const order = await prisma.disbursementOrder.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      items: {
        orderBy: { itemNameSnapshot: 'asc' },
        include: {
          workerPayroll: { select: { status: true } },
          crewPayroll: { select: { status: true } },
          equipmentPayroll: { select: { status: true } },
        },
      },
    },
  })

  if (!order) {
    return new Response('Esa orden de desembolso no existe.', { status: 404 })
  }

  const pdf = renderDisbursementPdf({
    orderNumber: order.orderNumber,
    status: label(ESTADO_ORDEN, order.status),
    companyName: order.companyNameSnapshot,
    recipientName: order.recipientNameSnapshot,
    recipientTaxId: order.recipientTaxIdSnapshot,
    weekLabel: order.weekLabelSnapshot,
    periodStart: toIso(order.periodStart),
    periodEnd: toIso(order.periodEnd),
    createdAt: toIso(order.createdAt),
    workers: order.items.map((item) => ({
      name: item.itemNameSnapshot,
      detail: item.itemDetailSnapshot,
      amount: item.amount.toFixed(2),
      paid: ['PAID', 'RECONCILED', 'CLOSED'].includes(
        item.workerPayroll?.status ?? item.crewPayroll?.status ?? item.equipmentPayroll?.status ?? '',
      ),
      group: item.crewLabelSnapshot,
    })),
    total: order.totalAmount.toFixed(2),
    amountPaid: order.amountPaid.toFixed(2),
    preparedBy: order.preparedByName,
    approvedBy: order.approvedByName,
    approvedAt: order.approvedAt ? toIso(order.approvedAt) : null,
    paidBy: order.paidByName,
    paidAt: order.paidAt ? toIso(order.paidAt) : null,
    paymentDate: order.paymentDate ? toIso(order.paymentDate) : null,
    method: order.method ? label(METODO_PAGO, order.method) : null,
    bankName: order.bankName,
    reference: order.reference,
    notes: order.paymentNotes ?? order.notes,
    differenceReason: order.differenceReason,
    cancellationReason: order.cancellationReason,
  })

  await prisma.auditLog.create({
    data: {
      companyId: user.companyId,
      userId: user.id,
      userEmailSnapshot: user.email,
      action: 'DISBURSEMENT_PDF_GENERATED',
      entityType: 'DisbursementOrder',
      entityId: order.id,
      payrollWeekId: order.payrollWeekId,
      newValueJson: { orderNumber: order.orderNumber },
      changedFields: [],
    },
  })

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${order.orderNumber}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
