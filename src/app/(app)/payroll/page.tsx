import { Badge, Button, Card, DataTable, EmptyState, Field, PageHeader, money } from '@/components/ui'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { toIso } from '@/lib/payroll/week'
import { openWeek } from './actions'

export const dynamic = 'force-dynamic'

export default async function PayrollPage() {
  const company = await getActiveCompany()
  const weeks = await prisma.payrollWeek.findMany({
    where: { companyId: company.id },
    orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
    include: {
      payrolls: true,
      _count: { select: { workEntries: true } },
    },
  })

  const today = toIso(new Date())

  return (
    <>
      <PageHeader title="Nómina" subtitle={company.displayName} />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <DataTable
          rows={weeks}
          href={(week) => `/payroll/${week.id}`}
          empty={
            <EmptyState
              title="Todavía no hay semanas abiertas"
              hint="Abre una semana con el formulario de la derecha para empezar a registrar días."
            />
          }
          columns={[
            { key: 'label', header: 'Semana', primary: true, render: (w) => `${w.label} · ${w.year}` },
            {
              key: 'range',
              header: 'Periodo',
              render: (w) => `${toIso(w.startDate)} → ${toIso(w.endDate)}`,
            },
            { key: 'days', header: 'Días registrados', align: 'right', render: (w) => String(w._count.workEntries) },
            { key: 'people', header: 'Personas', align: 'right', render: (w) => String(w.payrolls.length) },
            {
              key: 'net',
              header: 'Neto',
              align: 'right',
              render: (w) =>
                `$${money(w.payrolls.reduce((total, p) => total + Number(p.netPay), 0))}`,
            },
            {
              key: 'status',
              header: 'Estado',
              render: (w) =>
                w.status === 'CLOSED' ? <Badge>Cerrada</Badge> : <Badge tone="info">Abierta</Badge>,
            },
          ]}
        />

        <Card>
          <h2 className="text-sm font-semibold">Abrir una semana</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Elige cualquier día. El sistema toma la semana completa de domingo a sábado, con la
            misma numeración que usan hoy en Excel.
          </p>
          <form action={openWeek} className="mt-3 space-y-3">
            <Field label="Fecha" name="date" type="date" required defaultValue={today} />
            <Button>Abrir semana</Button>
          </form>
        </Card>
      </div>
    </>
  )
}
