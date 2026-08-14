import Link from 'next/link'
import { EmptyState, PageHeader, money } from '@/components/ui'
import { Kpi } from '@/components/ui/metrics'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { marginReport, type MarginBreakdown, type MarginFilters } from '@/lib/margin/service'
import type { MarginView } from '@/lib/margin'
import { MarginFilterBar } from './MarginFilterBar'

export const dynamic = 'force-dynamic'

/** Convierte lo que viene en la dirección web en un filtro, ignorando basura. */
function readFilters(params: Record<string, string | string[] | undefined>): MarginFilters {
  const one = (key: string) => {
    const value = params[key]
    const text = Array.isArray(value) ? value[0] : value
    return text && text !== '' ? text : undefined
  }
  const date = (key: string) => {
    const text = one(key)
    if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined
    const parsed = new Date(`${text}T00:00:00Z`)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }

  const filters: MarginFilters = {}
  const from = date('desde')
  const to = date('hasta')
  const crewId = one('cuadrilla')
  const projectId = one('proyecto')
  const customerId = one('cliente')
  const operationId = one('operacion')

  if (from) filters.from = from
  if (to) filters.to = to
  if (crewId) filters.crewId = crewId
  if (projectId) filters.projectId = projectId
  if (customerId) filters.customerId = customerId
  if (operationId) filters.operationId = operationId
  return filters
}

/**
 * Rentabilidad: venta, costo y margen.
 *
 * La regla que gobierna esta pantalla: **nunca mostrar un margen que parezca
 * completo cuando no lo está**. Si faltan tarifas de venta, se dice arriba y en
 * cada fila, porque alguien va a tomar decisiones con estos números.
 */
export default async function MarginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await assertCan('dashboard:view')
  const company = await getActiveCompany()

  const params = await searchParams
  const filters = readFilters(params)
  const filtering = Object.keys(filters).length > 0

  const [report, crews, projects, customers, operations] = await Promise.all([
    marginReport(company.id, filters),
    prisma.crew.findMany({
      where: { companyId: company.id },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.project.findMany({
      where: { companyId: company.id },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.customer.findMany({
      where: { companyId: company.id },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.operation.findMany({
      where: { companyId: company.id },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    }),
  ])

  const nothing = Number(report.total.cost) === 0 && Number(report.total.revenue) === 0

  return (
    <>
      <PageHeader
        title="Rentabilidad"
        subtitle={`Venta, costo y margen · ${company.displayName}`}
      />

      <MarginFilterBar
        crews={crews.map((row) => ({ value: row.id, label: row.name }))}
        projects={projects.map((row) => ({ value: row.id, label: row.name }))}
        customers={customers.map((row) => ({ value: row.id, label: row.name }))}
        operations={operations.map((row) => ({ value: row.id, label: row.name }))}
        current={params}
      />

      {nothing ? (
        <EmptyState
          title={filtering ? 'Nada coincide con ese filtro' : 'Todavía no hay nada que medir'}
          hint={
            filtering
              ? 'Prueba con otro rango de fechas, otra cuadrilla u otro proyecto.'
              : 'Cuando se calcule una nómina, aquí aparece cuánto costó, cuánto se vendió y cuánto quedó.'
          }
        />
      ) : (
        <>
          {report.total.warning ? (
            <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900">
              <p>
                <strong>Estos números están incompletos.</strong> {report.total.warning}
              </p>
              <p className="mt-1 text-xs">
                Mientras falten, la venta que se muestra es solo la de los días que sí tienen
                tarifa, y el porcentaje no se calcula: sería mentira.{' '}
                <Link
                  prefetch={false}
                  href="/billing-rates"
                  className="text-[var(--accent)] underline"
                >
                  Configurar tarifas de venta
                </Link>
              </p>
            </div>
          ) : null}

          <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Venta" value={`$${money(report.total.revenue)}`} />
            <Kpi label="Costo de la gente" value={`$${money(report.total.cost)}`} />
            <Kpi
              label="Margen bruto"
              value={`$${money(report.total.margin)}`}
              hint={Number(report.total.margin) < 0 ? 'está en rojo' : undefined}
            />
            <Kpi
              label="Margen %"
              value={report.total.marginPct === null ? '—' : `${report.total.marginPct}%`}
              hint={report.total.marginPct === null ? 'falta tarifa de venta' : undefined}
            />
          </section>

          <Breakdown title="Por semana" rows={report.byWeek} unit="persona(s)" />
          <Breakdown title="Por cuadrilla" rows={report.byCrew} unit="persona(s)" />
          <Breakdown title="Por proyecto" rows={report.byProject} unit="persona(s)" />
        </>
      )}
    </>
  )
}

function Breakdown({
  title,
  rows,
  unit,
}: {
  title: string
  rows: readonly MarginBreakdown[]
  unit: string
}) {
  if (rows.length === 0) return null

  return (
    <section className="mb-6">
      <h2 className="brand-label mb-3 text-[var(--muted)]">{title}</h2>
      <div className="space-y-2">
        {rows.map((row) => (
          <Row key={row.key} label={row.label} workers={row.workers} unit={unit} view={row.view} />
        ))}
      </div>
    </section>
  )
}

function Row({
  label,
  workers,
  unit,
  view,
}: {
  label: string
  workers: number
  unit: string
  view: MarginView
}) {
  const negative = Number(view.margin) < 0

  return (
    <div
      className={`rounded-lg border bg-[var(--surface)] p-3 ${
        negative ? 'border-red-300' : view.complete ? 'border-[var(--border)]' : 'border-amber-300'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="min-w-[150px] flex-1">
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs text-[var(--muted)]">
            {workers} {unit}
          </p>
        </div>

        <Figure label="Venta" value={view.revenue} muted={!view.complete} />
        <Figure label="Costo" value={view.cost} />
        <Figure label="Margen" value={view.margin} strong negative={negative} />

        <div className="min-w-[70px] text-right">
          <p className="text-xs text-[var(--muted)]">%</p>
          <p
            className={`text-sm font-semibold tabular-nums ${
              negative ? 'text-red-700' : view.marginPct === null ? 'text-[var(--muted)]' : ''
            }`}
          >
            {view.marginPct === null ? '—' : `${view.marginPct}%`}
          </p>
        </div>
      </div>

      {view.warning ? (
        <p className="mt-2 border-t border-amber-300 pt-2 text-xs text-amber-900">
          {view.warning}
        </p>
      ) : null}
    </div>
  )
}

function Figure({
  label,
  value,
  strong,
  muted,
  negative,
}: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
  negative?: boolean
}) {
  return (
    <div className="min-w-[100px] text-right">
      <p className="text-xs text-[var(--muted)]">
        {label}
        {muted ? ' (parcial)' : ''}
      </p>
      <p
        className={`tabular-nums ${strong ? 'text-base font-semibold' : 'text-sm'} ${
          negative ? 'text-red-700' : ''
        }`}
      >
        ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2 })}
      </p>
    </div>
  )
}
