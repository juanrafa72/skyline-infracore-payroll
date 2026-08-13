import { Badge, Button, Card, DataTable, EmptyState, Field, PageHeader, money } from '@/components/ui'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { PAY_PERIOD_LABELS } from '@/lib/payroll/period'
import { toIso } from '@/lib/payroll/week'
import { openWeek } from './actions'

export const dynamic = 'force-dynamic'

export default async function PayrollPage() {
  const company = await getActiveCompany()
  const weeks = await prisma.payrollWeek.findMany({
    where: { companyId: company.id },
    orderBy: [{ year: 'desc' }, { startDate: 'desc' }],
    include: {
      payrolls: true,
      _count: { select: { workEntries: true } },
    },
  })

  const today = toIso(new Date())

  return (
    <>
      <PageHeader title="Nómina" subtitle={company.displayName} />

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <DataTable
          rows={weeks}
          href={(week) => `/payroll/${week.id}`}
          empty={
            <EmptyState
              title="Todavía no hay períodos abiertos"
              hint="Abre uno con el formulario de la derecha para empezar a registrar días."
            />
          }
          columns={[
            {
              key: 'label',
              header: 'Período',
              primary: true,
              render: (week) => (
                <span className="inline-flex items-center gap-2">
                  {week.label} · {week.year}
                  {week.isOffCycle ? <Badge tone="warning">corte</Badge> : null}
                </span>
              ),
            },
            {
              key: 'type',
              header: 'Frecuencia',
              render: (week) =>
                week.isOffCycle
                  ? week.settlementType === 'FINAL_SETTLEMENT'
                    ? 'Liquidación por retiro'
                    : 'Corte parcial'
                  : PAY_PERIOD_LABELS[week.periodType].split(' (')[0],
            },
            {
              key: 'range',
              header: 'Desde → hasta',
              render: (week) => `${toIso(week.startDate)} → ${toIso(week.endDate)}`,
            },
            { key: 'days', header: 'Días', align: 'right', render: (week) => String(week._count.workEntries) },
            { key: 'people', header: 'Personas', align: 'right', render: (week) => String(week.payrolls.length) },
            {
              key: 'net',
              header: 'Neto',
              align: 'right',
              render: (week) =>
                `$${money(week.payrolls.reduce((total, payroll) => total + Number(payroll.netPay), 0))}`,
            },
          ]}
        />

        <div className="space-y-4">
          <Card>
            <h2 className="text-sm font-semibold">Abrir período regular</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Elige cualquier día del período. El sistema calcula las fechas exactas del ciclo.
            </p>
            <form action={openWeek} className="mt-3 space-y-3">
              <input type="hidden" name="mode" value="regular" />
              <Field
                label="Frecuencia de pago"
                name="periodType"
                defaultValue={company.defaultPayPeriod}
                options={[
                  { value: 'DAILY', label: 'Diario' },
                  { value: 'WEEKLY', label: 'Semanal (domingo a sábado)' },
                  { value: 'BIWEEKLY', label: 'Catorcenal (cada 14 días)' },
                  { value: 'SEMI_MONTHLY', label: 'Quincenal (1–15 y 16–fin de mes)' },
                  { value: 'MONTHLY', label: 'Mensual' },
                ]}
              />
              <Field label="Un día del período" name="date" type="date" required defaultValue={today} />
              <Button>Abrir período</Button>
            </form>
          </Card>

          <Card className="border-amber-300 bg-amber-50">
            <h2 className="text-sm font-semibold text-amber-900">Corte fuera de calendario</h2>
            <p className="mt-1 text-xs text-amber-900">
              Para liquidar a alguien que se retira sin esperar el cierre normal. Elige tú las
              fechas. Queda marcado como corte, para que no se confunda con un período regular
              ni se cuente dos veces.
            </p>
            <form action={openWeek} className="mt-3 space-y-3">
              <input type="hidden" name="mode" value="cut" />
              <Field
                label="Motivo"
                name="settlementType"
                options={[
                  { value: 'FINAL_SETTLEMENT', label: 'Liquidación por retiro' },
                  { value: 'PARTIAL_CUT', label: 'Corte parcial (sigue trabajando)' },
                ]}
              />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Desde" name="cutFrom" type="date" required />
                <Field label="Hasta" name="cutTo" type="date" required defaultValue={today} />
              </div>
              <Field label="Nota" name="cutReason" placeholder="Se retira el viernes, se le paga todo" />
              <Button variant="secondary">Abrir corte</Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  )
}
