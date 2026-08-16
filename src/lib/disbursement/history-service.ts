import { prisma } from '@/lib/db/client'
import {
  aplicarFiltros,
  fechaDeFiltro,
  type FiltroHistorico,
  type PagoHistorico,
} from './history'

/**
 * El histórico de pagos contra la base de datos.
 *
 * Los totales viven en `./history.ts`, que es puro y se prueba sin base. Aquí
 * solo la consulta.
 */

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null)

function tipoDe(item: {
  workerPayrollId: string | null
  crewPayrollId: string | null
}): 'WORKER' | 'CREW' | 'EQUIPMENT' {
  if (item.workerPayrollId) return 'WORKER'
  if (item.crewPayrollId) return 'CREW'
  return 'EQUIPMENT'
}

/**
 * Las órdenes que cumplen el filtro, con lo que llevaba cada una.
 *
 * Se traen las PAGADAS y las que están esperando: el tablero sirve tanto para
 * ver lo que ya salió como para saber qué falta por salir.
 */
export async function historicoDePagos(
  companyId: string,
  filtro: FiltroHistorico = {},
): Promise<PagoHistorico[]> {
  const where: Record<string, unknown> = { companyId }

  if (filtro.recipientId) where.recipientId = filtro.recipientId

  /*
   * El rango se mide por la fecha de pago cuando existe, y si no por el
   * período de la semana: una orden sin pagar todavía no tiene fecha de pago,
   * y dejarla fuera del filtro la escondería justo cuando hay que perseguirla.
   */
  const desde = fechaDeFiltro(filtro.desde)
  const hasta = fechaDeFiltro(filtro.hasta)

  if (desde || hasta) {
    const rango: Record<string, Date> = {}
    if (desde) rango.gte = desde
    if (hasta) rango.lte = hasta
    where.OR = [{ paymentDate: rango }, { paymentDate: null, periodEnd: rango }]
  }

  const orders = await prisma.disbursementOrder.findMany({
    where,
    include: { items: true },
    orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
    take: 400,
  })

  const filas: PagoHistorico[] = orders.map((order) => ({
    orderId: order.id,
    orderNumber: order.orderNumber,
    recipientName: order.recipientNameSnapshot,
    recipientTaxId: order.recipientTaxIdSnapshot,
    weekLabel: order.weekLabelSnapshot,
    periodStart: iso(order.periodStart)!,
    periodEnd: iso(order.periodEnd)!,
    status: order.status,
    totalAmount: order.totalAmount.toFixed(2),
    amountPaid: order.amountPaid.toFixed(2),
    paymentDate: iso(order.paymentDate),
    method: order.method,
    bankName: order.bankName,
    reference: order.reference,
    paidByName: order.paidByName,
    approvedByName: order.approvedByName,
    itemCount: order.itemCount,
    items: order.items.map((item) => ({
      id: item.id,
      name: item.itemNameSnapshot,
      crewLabel: item.crewLabelSnapshot,
      detail: item.itemDetailSnapshot,
      amount: item.amount.toFixed(2),
      kind: tipoDe(item),
    })),
  }))

  return aplicarFiltros(filas, filtro)
}
