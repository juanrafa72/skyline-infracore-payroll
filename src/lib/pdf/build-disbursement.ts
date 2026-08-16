import { prisma } from '@/lib/db/client'
import { renderDisbursementPdf } from '@/lib/pdf/disbursement'
import { ESTADO_ORDEN, METODO_PAGO, label } from '@/lib/payroll/labels'
import { toIso } from '@/lib/payroll/week'

/**
 * Arma el desprendible de una orden a partir de lo guardado.
 *
 * Vive aparte de la ruta que lo descarga porque ahora hay DOS caminos que
 * necesitan el mismo documento: bajarlo y mandarlo por correo. Si cada uno lo
 * armara por su cuenta, el PDF que se descarga y el que recibe contabilidad
 * podrían decir cosas distintas.
 *
 * Todo sale de los snapshots congelados al aprobar, así que el documento de
 * hoy y el de dentro de un año dicen exactamente lo mismo.
 */
export async function buildDisbursementPdf(
  companyId: string,
  orderId: string,
): Promise<{ pdf: Buffer; orderNumber: string; payrollWeekId: string } | null> {
  const order = await prisma.disbursementOrder.findFirst({
    where: { id: orderId, companyId },
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

  if (!order) return null

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
        item.workerPayroll?.status ??
          item.crewPayroll?.status ??
          item.equipmentPayroll?.status ??
          '',
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

  return { pdf, orderNumber: order.orderNumber, payrollWeekId: order.payrollWeekId }
}
