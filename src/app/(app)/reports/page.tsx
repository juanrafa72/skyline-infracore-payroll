import { DataTable, EmptyState, LinkButton, PageHeader, money } from '@/components/ui'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { toIso } from '@/lib/payroll/week'

export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const company = await getActiveCompany()

  const [weekRows, workerRows] = await Promise.all([
    prisma.workerPayroll.groupBy({
      by: ['payrollWeekId'],
      where: { companyId: company.id },
      _sum: { grossPay: true, deductionsTotal: true, netPay: true },
      _count: { _all: true },
    }),
    prisma.workerPayroll.groupBy({
      by: ['workerId'],
      where: { companyId: company.id },
      _sum: { grossPay: true, netPay: true },
      _count: { _all: true },
    }),
  ])

  const [weeks, workers] = await Promise.all([
    prisma.payrollWeek.findMany({
      where: { id: { in: weekRows.map((row) => row.payrollWeekId) } },
    }),
    prisma.worker.findMany({ where: { id: { in: workerRows.map((row) => row.workerId) } } }),
  ])

  const weekById = new Map(weeks.map((week) => [week.id, week]))
  const workerById = new Map(workers.map((worker) => [worker.id, worker]))

  const byWeek = weekRows
    .map((row) => ({ ...row, week: weekById.get(row.payrollWeekId) }))
    .filter((row) => row.week)
    .sort((a, b) => (b.week!.startDate > a.week!.startDate ? 1 : -1))

  const byWorker = workerRows
    .map((row) => ({ ...row, worker: workerById.get(row.workerId) }))
    .filter((row) => row.worker)
    .sort((a, b) => Number(b._sum.netPay ?? 0) - Number(a._sum.netPay ?? 0))

  return (
    <>
      <PageHeader title="Reportes" subtitle={company.displayName} />

      {byWeek.length === 0 ? (
        <EmptyState
          title="Todavía no hay nómina calculada"
          hint="Los reportes se arman solos a partir de las nóminas que vayas calculando."
          action={<LinkButton href="/payroll">Ir a nómina</LinkButton>}
        />
      ) : (
        <>
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">Costo por semana</h2>
            <DataTable
              rows={byWeek}
              href={(row) => `/payroll/${row.week!.id}`}
              empty={null}
              columns={[
                {
                  key: 'week',
                  header: 'Semana',
                  primary: true,
                  render: (row) => `${row.week!.label} · ${row.week!.year}`,
                },
                {
                  key: 'period',
                  header: 'Periodo',
                  render: (row) => `${toIso(row.week!.startDate)} → ${toIso(row.week!.endDate)}`,
                },
                { key: 'people', header: 'Personas', align: 'right', render: (row) => String(row._count._all) },
                { key: 'gross', header: 'Bruto', align: 'right', render: (row) => `$${money(row._sum.grossPay)}` },
                {
                  key: 'deductions',
                  header: 'Descuentos',
                  align: 'right',
                  render: (row) => `$${money(row._sum.deductionsTotal)}`,
                },
                { key: 'net', header: 'Neto', align: 'right', render: (row) => `$${money(row._sum.netPay)}` },
              ]}
            />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
              Acumulado por trabajador
            </h2>
            <DataTable
              rows={byWorker}
              href={(row) => `/workers/${row.worker!.id}`}
              empty={null}
              columns={[
                { key: 'worker', header: 'Trabajador', primary: true, render: (row) => row.worker!.displayName },
                { key: 'weeks', header: 'Semanas', align: 'right', render: (row) => String(row._count._all) },
                { key: 'gross', header: 'Bruto', align: 'right', render: (row) => `$${money(row._sum.grossPay)}` },
                { key: 'net', header: 'Neto', align: 'right', render: (row) => `$${money(row._sum.netPay)}` },
              ]}
            />
          </section>
        </>
      )}
    </>
  )
}
