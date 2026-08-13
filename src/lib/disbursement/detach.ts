import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'

/**
 * Sacar una nómina de su orden de desembolso cuando deja de estar aprobada.
 *
 * Existe por un hueco real: si alguien devuelve una nómina que ya está dentro
 * de una orden, o si la aprobación se cae sola porque cambió un día, la orden
 * se quedaría con el monto viejo. Tesorería vería un total que ya no
 * corresponde a nadie y transferiría de más o de menos, sin que nada avisara.
 *
 * Regla: mientras la orden no haya movido dinero, la nómina sale y la orden se
 * recalcula. Si ya movió dinero, la nómina NO se puede devolver — eso se
 * corrige con un ajuste o una reversión, que quedan registrados.
 */

export interface DetachResult {
  ok: boolean
  /** Motivo cuando no se puede, para mostrárselo a quien lo intentó. */
  reason?: string
  /** Órdenes que cambiaron, para poder anotarlo. */
  orderNumber?: string
  orderEmptied?: boolean
}

/** ¿Se puede sacar esta nómina de su orden? Sin tocar nada. */
export async function canDetach(workerPayrollId: string): Promise<DetachResult> {
  const item = await prisma.disbursementOrderItem.findUnique({
    where: { workerPayrollId },
    include: { order: true },
  })
  if (!item) return { ok: true }

  if (item.order.status === 'PAID' || item.order.status === 'PARTIALLY_PAID') {
    return {
      ok: false,
      reason:
        `Está en la orden ${item.order.orderNumber}, que ya tiene dinero desembolsado. ` +
        'No se puede devolver: corrígelo con un ajuste, que queda registrado.',
      orderNumber: item.order.orderNumber,
    }
  }

  return { ok: true, orderNumber: item.order.orderNumber }
}

/**
 * Saca la nómina de su orden y recalcula el total.
 *
 * Si la orden se queda sin nadie, se anula con el motivo: dejarla en cero
 * haría que tesorería viera una transferencia de $0 sin explicación.
 */
export async function detachFromOrder(
  tx: Prisma.TransactionClient,
  workerPayrollId: string,
  why: string,
): Promise<DetachResult> {
  const item = await tx.disbursementOrderItem.findUnique({
    where: { workerPayrollId },
    include: { order: true },
  })
  if (!item) return { ok: true }

  if (item.order.status === 'PAID' || item.order.status === 'PARTIALLY_PAID') {
    return {
      ok: false,
      reason: `La orden ${item.order.orderNumber} ya tiene dinero desembolsado.`,
      orderNumber: item.order.orderNumber,
    }
  }

  await tx.disbursementOrderItem.delete({ where: { id: item.id } })

  const totals = await tx.disbursementOrderItem.aggregate({
    where: { disbursementOrderId: item.disbursementOrderId },
    _sum: { amount: true },
    _count: true,
  })

  if (totals._count === 0) {
    await tx.disbursementOrder.update({
      where: { id: item.disbursementOrderId },
      data: {
        status: 'CANCELLED',
        cancellationReason: `Quedó sin trabajadores: ${why}`,
        cancelledAt: new Date(),
        totalAmount: 0,
        workerCount: 0,
      },
    })
    return { ok: true, orderNumber: item.order.orderNumber, orderEmptied: true }
  }

  await tx.disbursementOrder.update({
    where: { id: item.disbursementOrderId },
    data: { totalAmount: totals._sum.amount ?? 0, workerCount: totals._count },
  })

  return { ok: true, orderNumber: item.order.orderNumber }
}
