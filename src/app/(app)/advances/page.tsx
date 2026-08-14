import { PageHeader, money } from '@/components/ui'
import { Kpi } from '@/components/ui/metrics'
import { listAdvances } from '@/lib/advances/service'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { AdvancePanel, type Beneficiary } from './AdvancePanel'

export const dynamic = 'force-dynamic'

export default async function AdvancesPage() {
  const user = await assertCan('advance:view')
  const company = await getActiveCompany()

  const [summary, workers, crews, contractors, recipients] = await Promise.all([
    listAdvances(user),
    prisma.worker.findMany({
      where: { companyId: company.id, status: 'ACTIVE' },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true },
    }),
    prisma.crew.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.contractor.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.paymentRecipient.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ])

  const beneficiaries: Beneficiary[] = [
    ...workers.map((row) => ({ id: row.id, name: row.displayName, type: 'WORKER' as const })),
    ...crews.map((row) => ({ id: row.id, name: row.name, type: 'CREW' as const })),
    ...contractors.map((row) => ({ id: row.id, name: row.name, type: 'CONTRACTOR' as const })),
    ...recipients.map((row) => ({ id: row.id, name: row.name, type: 'RECIPIENT' as const })),
  ]

  const active = summary.rows.filter(
    (row) => row.status === 'ACTIVE' || row.status === 'PARTIALLY_RECOVERED',
  ).length

  return (
    <>
      <PageHeader
        title="Préstamos"
        subtitle={`Lo que se adelantó y falta por recuperar · ${company.displayName}`}
      />

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Por recuperar" value={`$${money(summary.totalOutstanding)}`} />
        <Kpi label="Prestado en total" value={`$${money(summary.totalLent)}`} />
        <Kpi label="Préstamos activos" value={String(active)} />
        <Kpi
          label="Esperando aprobación"
          value={String(summary.awaitingApproval)}
          hint={summary.awaitingApproval > 0 ? 'no se descuentan hasta aprobarse' : 'ninguno'}
        />
      </section>

      <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <p className="font-semibold">Cómo funciona</p>
        <p className="mt-1 text-[var(--muted)]">
          Se le adelanta plata a alguien —una persona, una cuadrilla o una empresa— y se acuerda
          cómo se recupera. Al llegar la semana, el descuento aparece en su pago según ese plan.
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          El saldo no se edita a mano: sale de lo prestado menos los abonos. Y nunca se descuenta
          más de lo que se debe, aunque el plan diga una cifra mayor.
        </p>
      </div>

      <AdvancePanel
        rows={summary.rows}
        beneficiaries={beneficiaries}
        canApprove={user.permissions.has('advance:approve')}
        today={new Date().toISOString().slice(0, 10)}
      />
    </>
  )
}
