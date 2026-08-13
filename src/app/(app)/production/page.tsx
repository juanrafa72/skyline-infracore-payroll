import Link from 'next/link'
import { Badge, EmptyState, LinkButton, PageHeader, money } from '@/components/ui'
import { BarList, Kpi, Panel } from '@/components/ui/metrics'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { toIso, weekRangeOf } from '@/lib/payroll/week'
import { ProductionForm } from './ProductionForm'
import { deleteProduction } from './actions'

export const dynamic = 'force-dynamic'

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string }>
}) {
  const params = await searchParams
  const company = await getActiveCompany()

  const today = toIso(new Date())
  const range = params.semana ? weekRangeOf(params.semana) : weekRangeOf(today)

  const [records, pricing, weeks] = await Promise.all([
    prisma.production.findMany({
      where: {
        companyId: company.id,
        productionDate: {
          gte: new Date(`${range.startDate}T00:00:00Z`),
          lte: new Date(`${range.endDate}T00:00:00Z`),
        },
      },
      orderBy: [{ productionDate: 'desc' }],
      include: { crew: true, project: true },
    }),
    prisma.crewPricing.findMany({
      where: { companyId: company.id, active: true },
      orderBy: [{ crew: { name: 'asc' } }, { unitLabel: 'asc' }],
      include: { crew: true, project: true },
    }),
    prisma.payrollWeek.findMany({
      where: { companyId: company.id, isOffCycle: false },
      orderBy: [{ startDate: 'desc' }],
      take: 12,
    }),
  ])

  const total = records.reduce((sum, row) => sum + Number(row.amount), 0)

  const byCrew = new Map<string, { label: string; amount: number; quantity: number }>()
  const byUnit = new Map<string, { label: string; amount: number; quantity: number }>()
  for (const record of records) {
    const crewKey = record.crew?.name ?? 'Sin cuadrilla'
    const crew = byCrew.get(crewKey) ?? { label: crewKey, amount: 0, quantity: 0 }
    crew.amount += Number(record.amount)
    crew.quantity += Number(record.quantity)
    byCrew.set(crewKey, crew)

    const unit = byUnit.get(record.unitLabel) ?? { label: record.unitLabel, amount: 0, quantity: 0 }
    unit.amount += Number(record.amount)
    unit.quantity += Number(record.quantity)
    byUnit.set(record.unitLabel, unit)
  }

  return (
    <>
      <PageHeader
        title="Producción"
        subtitle={`${range.label} · ${range.startDate} → ${range.endDate} · ${company.displayName}`}
        action={<LinkButton href="/crews" variant="secondary">Negociaciones</LinkButton>}
      />

      <div className="mb-5 flex flex-wrap gap-1.5">
        {weeks.map((week) => {
          const isActive = toIso(week.startDate) === range.startDate
          return (
            <Link
              key={week.id}
              href={`/production?semana=${toIso(week.startDate)}`}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                isActive
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--hover)]'
              }`}
            >
              S{week.weekNumber}
            </Link>
          )
        })}
      </div>

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        <Kpi label="Producción de la semana" value={`$${money(total)}`} />
        <Kpi label="Registros" value={String(records.length)} />
        <Kpi label="Cuadrillas con producción" value={String(byCrew.size)} />
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {records.length === 0 ? (
            <EmptyState
              title="Sin producción registrada esta semana"
              hint={
                pricing.length === 0
                  ? 'Primero define la negociación de una cuadrilla (strand, fibra y sus precios).'
                  : 'Registra lo producido con el formulario de la derecha.'
              }
              action={
                pricing.length === 0 ? (
                  <LinkButton href="/crews">Ir a cuadrillas</LinkButton>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-[var(--hover)]">
                  <tr>
                    {['Fecha', 'Cuadrilla', 'Concepto', 'Cantidad', 'Precio', 'Importe', ''].map(
                      (header, index) => (
                        <th
                          key={header}
                          className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] ${
                            index >= 3 && index <= 5 ? 'text-right' : 'text-left'
                          }`}
                        >
                          {header}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2 tabular-nums">{toIso(record.productionDate)}</td>
                      <td className="px-3 py-2">
                        {record.crew ? (
                          <Link
                            href={`/crews/${record.crewId}`}
                            className="font-medium text-[var(--accent)] hover:underline"
                          >
                            {record.crew.name}
                          </Link>
                        ) : (
                          '—'
                        )}
                        {record.project ? (
                          <span className="block text-xs text-[var(--muted)]">
                            {record.project.name}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{record.unitLabel}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(record.quantity).toLocaleString('en-US')}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[var(--muted)]">
                        ${Number(record.appliedPrice).toFixed(4)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        ${money(record.amount)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <form action={deleteProduction}>
                          <input type="hidden" name="id" value={record.id} />
                          <button
                            type="submit"
                            className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted)] hover:border-red-300 hover:text-red-700"
                          >
                            borrar
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-[var(--border)] bg-[var(--hover)] font-semibold">
                    <td className="px-3 py-2" colSpan={5}>
                      Total
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">${money(total)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {records.length > 0 ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <Panel title="Por cuadrilla">
                <BarList
                  rows={[...byCrew.values()]
                    .sort((a, b) => b.amount - a.amount)
                    .map((row) => ({
                      label: row.label,
                      value: Math.round(row.amount),
                      detail: `${row.quantity.toLocaleString('en-US')} unidades`,
                    }))}
                  unit=" $"
                />
              </Panel>
              <Panel title="Por concepto">
                <BarList
                  rows={[...byUnit.values()]
                    .sort((a, b) => b.amount - a.amount)
                    .map((row) => ({
                      label: row.label,
                      value: Math.round(row.amount),
                      detail: `${row.quantity.toLocaleString('en-US')} unidades`,
                    }))}
                  unit=" $"
                />
              </Panel>
            </div>
          ) : null}
        </div>

        <div>
          {pricing.length === 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Falta la negociación</p>
              <p className="mt-1">
                Para registrar producción hay que saber a cuánto se paga cada concepto. Ve a
                Cuadrillas y agrega los precios acordados (strand, fibra…).
              </p>
              <p className="mt-2 text-xs">
                El precio no se escribe aquí a propósito: sale de la negociación vigente ese día,
                para que nadie pueda inventarlo al capturar.
              </p>
            </div>
          ) : (
            <ProductionForm
              options={pricing.map((price) => ({
                id: price.id,
                crewId: price.crewId,
                label: `${price.crew.name} · ${price.unitLabel} · $${Number(price.pricePerUnit).toFixed(4)}/${price.unitOfMeasure === 'FOOT' ? 'pie' : price.unitOfMeasure.toLowerCase()}${price.project ? ` · ${price.project.name}` : ''}`,
              }))}
              defaultDate={today}
            />
          )}

          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-xs text-[var(--muted)]">
            <p className="font-semibold text-[var(--foreground)]">Cómo se calcula</p>
            <p className="mt-1">
              Importe = cantidad × precio vigente ese día. El precio queda congelado en el
              registro: cambiar la negociación mañana no altera lo ya registrado.
            </p>
            <p className="mt-2">
              <Badge>siguiente</Badge> Con producción y costo de nómina en el mismo período, el
              sistema podrá mostrar el margen por cuadrilla y por proyecto.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
