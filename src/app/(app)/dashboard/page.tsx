import Link from 'next/link'
import { Badge, Card, LinkButton, PageHeader, Stat, money } from '@/components/ui'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { toIso, weekRangeOf } from '@/lib/payroll/week'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const company = await getActiveCompany()
  const currentRange = weekRangeOf(toIso(new Date()))

  const [workers, crews, projects, weeks, payrolls, exceptions, pendingRules] = await Promise.all([
    prisma.worker.count({ where: { companyId: company.id, status: 'ACTIVE' } }),
    prisma.crew.count({ where: { companyId: company.id, active: true } }),
    prisma.project.count({ where: { companyId: company.id, active: true } }),
    prisma.payrollWeek.findMany({
      where: { companyId: company.id },
      orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
      take: 5,
      include: { payrolls: true },
    }),
    prisma.workerPayroll.findMany({ where: { companyId: company.id } }),
    prisma.exception.count({ where: { companyId: company.id, status: 'OPEN', level: 'CRITICAL' } }),
    prisma.companySetting.count({
      where: { companyId: company.id, needsBusinessConfirmation: true, confirmed: false },
    }),
  ])

  const byStatus = (statuses: readonly string[]) =>
    payrolls.filter((payroll) => statuses.includes(payroll.status))

  const sumNet = (rows: typeof payrolls) =>
    rows.reduce((total, payroll) => total + Number(payroll.netPay), 0)

  const currentWeek = weeks.find(
    (week) => week.year === currentRange.year && week.weekNumber === currentRange.weekNumber,
  )

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${company.legalName} · ${currentRange.label} de ${currentRange.year}`}
        action={
          currentWeek ? (
            <LinkButton href={`/payroll/${currentWeek.id}`}>Ir a la semana actual</LinkButton>
          ) : (
            <LinkButton href="/payroll">Abrir la semana actual</LinkButton>
          )
        }
      />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">Nómina</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="En preparación"
            value={`$${money(sumNet(byStatus(['DRAFT', 'PREPARED'])))}`}
            hint={`${byStatus(['DRAFT', 'PREPARED']).length} personas`}
          />
          <Stat
            label="Esperando aprobación"
            value={`$${money(sumNet(byStatus(['PENDING_APPROVAL'])))}`}
            hint={`${byStatus(['PENDING_APPROVAL']).length} personas`}
          />
          <Stat
            label="Listas para pagar"
            value={`$${money(sumNet(byStatus(['APPROVED', 'READY_TO_PAY'])))}`}
            hint={`${byStatus(['APPROVED', 'READY_TO_PAY']).length} personas`}
          />
          <Stat
            label="Pagadas"
            value={`$${money(sumNet(byStatus(['PAID', 'RECONCILED', 'CLOSED'])))}`}
            tone="good"
            hint={`${byStatus(['PAID', 'RECONCILED', 'CLOSED']).length} personas`}
          />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">Personal</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Trabajadores activos" value={String(workers)} />
          <Stat label="Cuadrillas" value={String(crews)} />
          <Stat label="Proyectos activos" value={String(projects)} />
          <Stat
            label="Errores críticos"
            value={String(exceptions)}
            tone={exceptions > 0 ? 'warning' : 'default'}
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold">Últimas semanas</h2>
          {weeks.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              Todavía no hay semanas abiertas.{' '}
              <Link href="/payroll" className="text-[var(--accent)] underline">
                Abrir una
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {weeks.map((week) => (
                <li key={week.id}>
                  <Link
                    href={`/payroll/${week.id}`}
                    className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--hover)]"
                  >
                    <span className="font-medium">
                      {week.label} · {week.year}
                    </span>
                    <span className="tabular-nums text-[var(--muted)]">
                      {week.payrolls.length} pers. · ${money(sumNet(week.payrolls))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className={pendingRules > 0 ? 'border-amber-300 bg-amber-50' : ''}>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Reglas sin confirmar</h2>
            {pendingRules > 0 ? <Badge tone="warning">{pendingRules}</Badge> : null}
          </div>
          <p className="mt-2 text-sm text-amber-900">
            Cada una puede cambiar cuánto recibe una persona. Mientras no se confirmen, el
            sistema usa el valor más conservador y lo deja marcado.
          </p>
          <p className="mt-2 text-xs text-amber-800">
            Detalle en <code>docs/EXCEL_ANALYSIS.md</code>, apartado 5 (A1 a A15).
          </p>
        </Card>
      </div>
    </>
  )
}
