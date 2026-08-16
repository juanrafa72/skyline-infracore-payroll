import Link from 'next/link'
import { Badge, Button, Card, DataTable, EmptyState, Field, PageHeader, money } from '@/components/ui'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { CON_TRABAJO_NUESTRO } from '@/lib/payroll/week-scope'
import { PAY_PERIOD_LABELS } from '@/lib/payroll/period'
import { toIso } from '@/lib/payroll/week'
import { openWeek } from './actions'

export const dynamic = 'force-dynamic'

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ archivo?: string }>
}) {
  const company = await getActiveCompany()
  const { archivo } = await searchParams
  const verArchivo = archivo === '1'

  /*
   * De 140 semanas, 137 son archivo del Excel: días importados que jamás
   * generaron nómina (BR-153). Mezcladas, hay que bajar por 120 filas en
   * $0.00 para llegar a la que se está trabajando. Se muestran solo las que
   * tienen trabajo nuestro, y el archivo queda detrás de un enlace.
   */
  const weeks = await prisma.payrollWeek.findMany({
    where: verArchivo ? { companyId: company.id } : { companyId: company.id, ...CON_TRABAJO_NUESTRO },
    orderBy: [{ year: 'desc' }, { startDate: 'desc' }],
    include: {
      payrolls: true,
      _count: { select: { workEntries: true } },
    },
  })

  const total = await prisma.payrollWeek.count({ where: { companyId: company.id } })
  const enArchivo = total - (verArchivo ? total : weeks.length)

  const today = toIso(new Date())

  return (
    <>
      <PageHeader
        title="Nómina"
        subtitle={
          verArchivo
            ? `${company.displayName} · todas las semanas, incluido el archivo del Excel`
            : `${company.displayName} · las semanas que se han trabajado aquí`
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div>
        <DataTable
          rows={weeks}
          href={(week) => `/payroll/${week.id}`}
          empty={
            <EmptyState
              title="Todavía no se ha trabajado ninguna semana aquí"
              hint="Abre un período con el formulario de la derecha y marca los días de la gente."
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

        {/*
          El archivo del Excel, detrás de un enlace. Son días importados que
          jamás generaron nómina (BR-153): mirarlos sirve para consultar, no
          para trabajar, y de primeras solo estorban.
        */}
        {verArchivo ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            Estás viendo <strong>todas</strong> las semanas, incluidas las que solo son archivo
            del Excel. Sus días ya se pagaron por fuera: no hay que calcularlas.{' '}
            <Link prefetch={false} href="/payroll" className="underline">
              Ver solo lo trabajado aquí
            </Link>
          </p>
        ) : enArchivo > 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            Hay <strong>{enArchivo}</strong> semana(s) más que vinieron del Excel. Sus días ya se
            pagaron por fuera, así que no aparecen aquí.{' '}
            <Link prefetch={false} href="/payroll?archivo=1" className="underline">
              Ver el archivo completo
            </Link>
          </p>
        ) : null}
        </div>

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
