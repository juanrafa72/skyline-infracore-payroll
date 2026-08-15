import { Badge, EmptyState, PageHeader, money } from '@/components/ui'
import { Kpi } from '@/components/ui/metrics'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { toIso } from '@/lib/payroll/week'
import { PaymentPanel } from './PaymentPanel'
import { METODO_PAGO, label } from '@/lib/payroll/labels'

export const dynamic = 'force-dynamic'

export default async function PaymentsPage() {
  const user = await assertCan('payment:view')
  const company = await getActiveCompany()

  const [ready, readyCrews, readyEquipment, recent, openVariances] = await Promise.all([
    prisma.workerPayroll.findMany({
      where: { companyId: company.id, status: { in: ['APPROVED', 'READY_TO_PAY'] } },
      include: { worker: true, payrollWeek: true },
      orderBy: [{ payrollWeek: { startDate: 'desc' } }, { worker: { displayName: 'asc' } }],
    }),
    prisma.crewPayroll.findMany({
      where: { companyId: company.id, status: { in: ['APPROVED', 'READY_TO_PAY'] } },
      select: { crewNameSnapshot: true, contractorNameSnapshot: true, productionTotal: true },
    }),
    prisma.equipmentPayroll.findMany({
      where: { companyId: company.id, status: { in: ['APPROVED', 'READY_TO_PAY'] } },
      select: { equipmentNameSnapshot: true, vendorNameSnapshot: true, totalAmount: true },
    }),
    prisma.payment.findMany({
      where: { companyId: company.id, status: 'PAID' },
      include: { worker: true, payrollWeek: true },
      orderBy: { paidAt: 'desc' },
      take: 15,
    }),
    prisma.variance.count({ where: { companyId: company.id, status: 'OPEN' } }),
  ])

  const total = ready.reduce((sum, row) => sum + Number(row.netPay), 0)
  const crewEquipTotal =
    readyCrews.reduce((sum, row) => sum + Number(row.productionTotal), 0) +
    readyEquipment.reduce((sum, row) => sum + Number(row.totalAmount), 0)
  const canPay = user.permissions.has('payment:execute')

  return (
    <>
      <PageHeader
        title="Pagos"
        subtitle={`${ready.length} aprobada(s) esperando pago · ${company.displayName}`}
      />

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Listas para pagar" value={String(ready.length)} />
        <Kpi label="Total a pagar" value={`$${money(total)}`} />
        <Kpi label="Pagos recientes" value={String(recent.length)} />
        <Kpi
          label="Diferencias abiertas"
          value={String(openVariances)}
          hint={openVariances > 0 ? 'pagos por debajo de lo aprobado' : 'ninguna'}
        />
      </section>

      {readyCrews.length > 0 || readyEquipment.length > 0 ? (
        <div className="mb-5 rounded-lg border border-sky-300 bg-sky-50 p-3.5 text-sm text-sky-900">
          <strong>
            {readyCrews.length > 0 ? `${readyCrews.length} cuadrilla(s)` : ''}
            {readyCrews.length > 0 && readyEquipment.length > 0 ? ' y ' : ''}
            {readyEquipment.length > 0 ? `${readyEquipment.length} equipo(s)` : ''} aprobada(s) ·
            ${money(crewEquipTotal)}.
          </strong>{' '}
          Se pagan por su orden de desembolso, en{' '}
          <a href="/disbursements" className="underline">
            Desembolsos
          </a>
          :{' '}
          {[
            ...readyCrews.map(
              (row) => `${row.crewNameSnapshot}${row.contractorNameSnapshot ? ` (${row.contractorNameSnapshot})` : ''}`,
            ),
            ...readyEquipment.map(
              (row) => `${row.equipmentNameSnapshot}${row.vendorNameSnapshot ? ` (${row.vendorNameSnapshot})` : ''}`,
            ),
          ].join(', ')}
          .
        </div>
      ) : null}

      <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <p className="font-semibold">Qué se puede y qué no</p>
        <p className="mt-1 text-[var(--muted)]">
          Aquí solo se registra el pago: fecha, método, monto y referencia. Los días, la tarifa,
          el bruto, los descuentos y el neto <strong>no se pueden modificar</strong> desde esta
          pantalla. Si algo está mal, devuelve la nómina con el motivo y quien aprueba la revisa.
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Pagar por encima de lo aprobado está bloqueado. Pagar por debajo se permite, pero deja
          una diferencia abierta que alguien tendrá que explicar.
        </p>
      </div>

      {ready.length === 0 ? (
        <EmptyState
          title="No hay nada aprobado esperando pago"
          hint="Cuando se apruebe una nómina, aparecerá aquí lista para registrar el pago."
        />
      ) : (
        <PaymentPanel
          canPay={canPay}
          rows={ready.map((row) => ({
            id: row.id,
            workerName: row.worker.displayName,
            weekLabel: `${row.payrollWeek.label} · ${row.payrollWeek.year}`,
            period: `${toIso(row.payrollWeek.startDate)} → ${toIso(row.payrollWeek.endDate)}`,
            days: row.daysFull,
            halfDays: row.daysHalf,
            gross: row.grossPay.toFixed(2),
            deductions: row.deductionsTotal.toFixed(2),
            net: row.netPay.toFixed(2),
            approvedByMe: row.approvedById === user.id,
            bankLast4: row.worker.bankAccountLast4,
          }))}
        />
      )}

      {recent.length > 0 ? (
        <section className="mt-8">
          <h2 className="brand-label mb-3 text-[var(--muted)]">Pagos recientes</h2>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-[var(--hover)]">
                <tr>
                  {['Pago', 'Persona', 'Semana', 'Método', 'Referencia', 'Aprobado', 'Pagado'].map(
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
                {recent.map((payment) => {
                  const difference = Number(payment.approvedAmount) - Number(payment.amountPaid)
                  return (
                    <tr key={payment.id} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2 font-mono text-xs">{payment.paymentNumber}</td>
                      <td className="px-3 py-2">{payment.worker?.displayName ?? '—'}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">
                        {payment.payrollWeek?.label ?? '—'}
                      </td>
                      <td className="px-3 py-2">{payment.method ? label(METODO_PAGO, payment.method) : '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{payment.reference}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[var(--muted)]">
                        ${money(payment.approvedAmount)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        ${money(payment.amountPaid)}
                        {difference > 0.001 ? (
                          <Badge tone="warning"> −${money(difference)}</Badge>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Falta subir el comprobante bancario a SharePoint y generar el recibo en PDF. Los pagos
            quedan registrados y auditados desde ya.
          </p>
        </section>
      ) : null}
    </>
  )
}
