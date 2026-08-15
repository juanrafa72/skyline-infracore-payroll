import { EmptyState, PageHeader, money } from '@/components/ui'
import { Kpi } from '@/components/ui/metrics'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { ESTADO_ORDEN, METODO_PAGO, TIPO_DOCUMENTO, label } from '@/lib/payroll/labels'
import { toIso } from '@/lib/payroll/week'
import { OrderCard, type OrderCardData } from './OrderCard'

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
   * Nóminas aprobadas que NO están en ninguna orden.
   *
   * Pasa con las que se aprobaron antes de que existieran las órdenes, y
   * pasaría si alguna se colara sin agrupar. Es plata aprobada que no aparece
   * en esta pantalla: callarlo sería esconder dinero pendiente.
   */
  const orphans = await prisma.workerPayroll.findMany({
    where: {
      companyId: company.id,
      status: { in: ['APPROVED', 'READY_TO_PAY'] },
      disbursementItem: null,
    },
    include: { worker: true, payrollWeek: true, paymentRecipient: true },
    orderBy: [{ payrollWeek: { startDate: 'desc' } }, { worker: { displayName: 'asc' } }],
  })

  const orders = await prisma.disbursementOrder.findMany({
    where: { companyId: company.id },
    include: {
      recipient: true,
      documents: { orderBy: { uploadedAt: 'desc' } },
      items: {
        orderBy: { itemNameSnapshot: 'asc' },
        include: { workerPayroll: { select: { status: true } } },
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
      // Hoy todos los renglones son de personas; las cuadrillas y equipos
      // entran en la fase de órdenes mixtas.
      workerPayrollId: item.workerPayrollId!,
      name: item.itemNameSnapshot,
      amount: item.amount.toFixed(2),
      paid: ['PAID', 'RECONCILED', 'CLOSED'].includes(item.workerPayroll?.status ?? ''),
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
        title="Desembolsos"
        subtitle={`${open.length} orden(es) por transferir · ${company.displayName}`}
      />

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Órdenes por pagar" value={String(open.length)} />
        <Kpi label="Total a transferir" value={`$${money(pendingTotal)}`} />
        <Kpi label="Empresas receptoras" value={String(recipientCount)} />
        <Kpi label="Trabajadores cubiertos" value={String(pendingWorkers)} />
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
        <section className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">
            {orphans.length} nómina(s) aprobada(s) sin orden de desembolso · $
            {money(orphans.reduce((sum, row) => sum + Number(row.netPay), 0))}
          </p>
          <p className="mt-1">
            Son de antes de que existieran las órdenes, o quedaron sin agrupar. No están perdidas
            —siguen en la pantalla de <strong>Pagar</strong>— pero aquí no se ven, así que se
            avisan para que nadie las dé por pagadas.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs">
            {orphans.slice(0, 12).map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {row.worker.displayName} · {row.payrollWeek.label} ·{' '}
                  {row.paymentRecipient?.name ?? 'sin empresa receptora'}
                </span>
                <span className="tabular-nums">${money(row.netPay)}</span>
              </li>
            ))}
          </ul>
          {orphans.length > 12 ? (
            <p className="mt-1 text-xs">y {orphans.length - 12} más.</p>
          ) : null}
          <p className="mt-2 text-xs">
            Para que entren aquí: devuélvelas a aprobación, asígnales empresa receptora y
            apruébalas de nuevo. Todo queda registrado.
          </p>
        </section>
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
    </>
  )
}
