import { EmptyState, PageHeader, money } from '@/components/ui'
import { FlowSteps, flowSteps } from '@/components/shell/FlowSteps'
import { Kpi } from '@/components/ui/metrics'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { ESTADO_ORDEN, METODO_PAGO, TIPO_DOCUMENTO, label } from '@/lib/payroll/labels'
import { toIso } from '@/lib/payroll/week'
import { OrderCard, type OrderCardData } from './OrderCard'
import { Orphans } from './Orphans'

export const dynamic = 'force-dynamic'

/**
 * Lo que ve quien transfiere el dinero.
 *
 * Una tarjeta por orden, y dentro de cada una las personas con su monto. La
 * regla de esta pantalla: nadie debería tener que abrir otra vista para saber
 * a quién le está pagando.
 */
export default async function DisbursementsPage() {
  const user = await assertCan('payment:view')
  const company = await getActiveCompany()

  /*
   * Liquidaciones aprobadas que NO están en ninguna orden.
   *
   * Normalmente no existen: la orden nace sola al aprobar. Pasa con las que se
   * aprobaron antes de que existieran las órdenes, o si un reparto no cuadró.
   * Es plata aprobada que no aparece en esta pantalla: callarlo sería esconder
   * dinero pendiente, así que se listan con el botón para agruparlas.
   */
  const [orphanWorkers, orphanCrews, orphanEquipment] = await Promise.all([
    prisma.workerPayroll.findMany({
      where: {
        companyId: company.id,
        status: { in: ['APPROVED', 'READY_TO_PAY'] },
        disbursementItem: null,
      },
      include: { worker: true, payrollWeek: true, paymentRecipient: true },
      orderBy: [{ payrollWeek: { startDate: 'desc' } }, { worker: { displayName: 'asc' } }],
    }),
    prisma.crewPayroll.findMany({
      where: {
        companyId: company.id,
        status: { in: ['APPROVED', 'READY_TO_PAY'] },
        disbursementItem: null,
      },
      include: { payrollWeek: true, paymentRecipient: true },
    }),
    prisma.equipmentPayroll.findMany({
      where: {
        companyId: company.id,
        status: { in: ['APPROVED', 'READY_TO_PAY'] },
        disbursementItem: null,
      },
      include: { payrollWeek: true, paymentRecipient: true },
    }),
  ])

  const orphans = [
    ...orphanWorkers.map((row) => ({
      id: row.id,
      name: row.worker.displayName,
      weekLabel: row.payrollWeek.label,
      recipientName: row.paymentRecipient?.name ?? null,
      amount: row.netPay.toFixed(2),
    })),
    ...orphanCrews.map((row) => ({
      id: row.id,
      name: `Cuadrilla ${row.crewNameSnapshot}`,
      weekLabel: row.payrollWeek.label,
      recipientName: row.paymentRecipient?.name ?? null,
      amount: row.productionTotal.toFixed(2),
    })),
    ...orphanEquipment.map((row) => ({
      id: row.id,
      name: `Equipo ${row.equipmentNameSnapshot}`,
      weekLabel: row.payrollWeek.label,
      recipientName: row.paymentRecipient?.name ?? null,
      amount: row.totalAmount.toFixed(2),
    })),
  ]

  const [recent, openVariances] = await Promise.all([
    prisma.payment.findMany({
      where: { companyId: company.id, status: 'PAID' },
      include: { worker: true, contractor: true, vendor: true, payrollWeek: true },
      orderBy: { paidAt: 'desc' },
      take: 15,
    }),
    prisma.variance.count({ where: { companyId: company.id, status: 'OPEN' } }),
  ])

  const orders = await prisma.disbursementOrder.findMany({
    where: { companyId: company.id },
    include: {
      recipient: true,
      documents: { orderBy: { uploadedAt: 'desc' } },
      items: {
        orderBy: { itemNameSnapshot: 'asc' },
        include: {
          workerPayroll: { select: { status: true } },
          crewPayroll: { select: { status: true } },
          equipmentPayroll: { select: { status: true } },
        },
      },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 60,
  })

  const cards: OrderCardData[] = orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    statusLabel: label(ESTADO_ORDEN, order.status),
    recipientName: order.recipientNameSnapshot,
    recipientTaxId: order.recipientTaxIdSnapshot,
    recipientBank: order.recipient.bankName,
    recipientPaymentDetails: order.recipient.paymentDetails,
    weekLabel: order.weekLabelSnapshot,
    period: `${toIso(order.periodStart)} → ${toIso(order.periodEnd)}`,
    total: order.totalAmount.toFixed(2),
    amountPaid: order.amountPaid.toFixed(2),
    workers: order.items.map((item) => ({
      itemId: item.id,
      name: item.itemNameSnapshot,
      crewLabel: item.crewLabelSnapshot,
      detail: item.itemDetailSnapshot,
      amount: item.amount.toFixed(2),
      paid: ['PAID', 'RECONCILED', 'CLOSED'].includes(
        item.workerPayroll?.status ?? item.crewPayroll?.status ?? item.equipmentPayroll?.status ?? '',
      ),
    })),
    approvedByName: order.approvedByName,
    preparedByName: order.preparedByName,
    paidByName: order.paidByName,
    paymentDate: order.paymentDate ? toIso(order.paymentDate) : null,
    methodLabel: order.method ? label(METODO_PAGO, order.method) : null,
    reference: order.reference,
    sentToAccounting: order.sentToAccountingTo,
    documents: order.documents.map((document) => ({
      fileName: document.fileName,
      fileRef: document.fileRef,
      kindLabel: label(TIPO_DOCUMENTO, document.kind),
    })),
  }))

  const open = cards.filter((card) => card.status === 'PENDING_PAYMENT' || card.status === 'PARTIALLY_PAID')
  const closed = cards.filter((card) => card.status === 'PAID' || card.status === 'CANCELLED')

  const pendingTotal = open.reduce(
    (sum, card) => sum + (Number(card.total) - Number(card.amountPaid)),
    0,
  )
  const pendingWorkers = open.reduce(
    (sum, card) => sum + card.workers.filter((worker) => !worker.paid).length,
    0,
  )
  const recipientCount = new Set(open.map((card) => card.recipientName)).size
  const canPay = user.permissions.has('payment:execute')

  return (
    <>
      <PageHeader
        title="Pagar"
        subtitle={`${open.length} orden(es) por transferir · ${company.displayName}`}
      />

      <FlowSteps current={4} steps={flowSteps(user.permissions)} className="mb-5" />

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Órdenes por pagar" value={String(open.length)} />
        <Kpi label="Total a transferir" value={`$${money(pendingTotal)}`} />
        <Kpi label="Empresas receptoras" value={String(recipientCount)} />
        <Kpi
          label="Renglones por pagar"
          value={String(pendingWorkers)}
          hint="personas, cuadrillas y equipos"
        />
      </section>

      <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <p className="font-semibold">Cómo funciona</p>
        <p className="mt-1 text-[var(--muted)]">
          Cada tarjeta es una transferencia: una empresa receptora, una semana, y las personas que
          cubre. Transfiere el total y registra aquí la fecha, el método y la referencia bancaria.
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Los montos no se pueden modificar desde esta pantalla. Si alguno está mal, no lo pagues:
          quien aprueba tiene que devolver la nómina y volver a aprobarla.
        </p>
      </div>

      {orphans.length > 0 ? (
        <Orphans
          rows={orphans}
          total={money(orphans.reduce((sum, row) => sum + Number(row.amount), 0))}
          canGenerate={user.permissions.has('payroll:approve')}
        />
      ) : null}

      {open.length === 0 && closed.length === 0 && orphans.length === 0 ? (
        <EmptyState
          title="No hay órdenes de desembolso"
          hint="Se generan solas cuando quien aprueba confirma una nómina y dice a qué empresa se le transfiere el dinero de cada persona."
        />
      ) : null}

      {open.length > 0 ? (
        <section className="space-y-4">
          {open.map((card) => (
            <OrderCard key={card.id} data={card} canPay={canPay} />
          ))}
        </section>
      ) : null}

      {closed.length > 0 ? (
        <section className="mt-8">
          <h2 className="brand-label mb-3 text-[var(--muted)]">
            Historial · {closed.length} orden(es)
          </h2>
          <div className="space-y-4">
            {closed.map((card) => (
              <OrderCard key={card.id} data={card} canPay={canPay} />
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Pagos registrados ────────────────────────────────────
          Vivían en otra pantalla. Quien acaba de transferir quiere ver que
          quedó registrado sin cambiar de sitio. */}
      {recent.length > 0 ? (
        <section className="mt-8">
          <h2 className="brand-label mb-3 text-[var(--muted)]">Pagos registrados</h2>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-[var(--hover)]">
                <tr>
                  {['Pago', 'A quién', 'Semana', 'Método', 'Referencia', 'Monto'].map(
                    (header, index) => (
                      <th
                        key={header}
                        className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] ${
                          index >= 5 ? 'text-right' : 'text-left'
                        }`}
                      >
                        {header}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {recent.map((payment) => (
                  <tr key={payment.id} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-mono text-xs">{payment.paymentNumber}</td>
                    <td className="px-3 py-2">
                      {payment.worker?.displayName ??
                        payment.contractor?.name ??
                        payment.vendor?.name ??
                        '—'}
                    </td>
                    <td className="px-3 py-2 text-[var(--muted)]">
                      {payment.payrollWeek?.label ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      {payment.method ? label(METODO_PAGO, payment.method) : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{payment.reference}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      ${money(payment.amountPaid)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {openVariances > 0 ? (
            <p className="mt-2 text-xs text-amber-800">
              {openVariances} diferencia(s) abierta(s) de pagos anteriores: se pagó menos de lo
              aprobado y quedó registrado. Hoy no puede volver a pasar — una orden se paga por
              renglones completos.
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
