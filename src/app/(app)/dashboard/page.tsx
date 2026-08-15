import Link from 'next/link'
import { Badge, PageHeader, money } from '@/components/ui'
import { BarList, Kpi, Panel, TrendBars } from '@/components/ui/metrics'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import {
  activityIn,
  byCrew,
  byOperation,
  byProject,
  controlSignals,
  daysWithPayroll,
  moneyIn,
  payrollPipeline,
  weeklyTrend,
} from '@/lib/payroll/dashboard'
import { RANGE_LABELS, change, resolveRange, type RangeKey } from '@/lib/payroll/ranges'
import { toIso, weekRangeOf } from '@/lib/payroll/week'

export const dynamic = 'force-dynamic'

const PIPELINE_LABELS: Record<string, string> = {
  DRAFT: 'En borrador',
  PREPARED: 'Preparada',
  PENDING_APPROVAL: 'Esperando aprobación',
  REJECTED: 'Rechazada',
  APPROVED: 'Aprobada',
  READY_TO_PAY: 'Lista para pagar',
  PAYMENT_IN_PROCESS: 'Pago en proceso',
  PAID: 'Pagada',
  RECONCILED: 'Conciliada',
  CLOSED: 'Cerrada',
  IMPORTED_HISTORICAL: 'Histórico importado',
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>
}) {
  const params = await searchParams
  const company = await getActiveCompany()

  const today = toIso(new Date())
  const key = (Object.keys(RANGE_LABELS) as RangeKey[]).includes(params.r as RangeKey)
    ? (params.r as RangeKey)
    : 'semana'
  const range = resolveRange(key, today)

  const [
    activity,
    previousActivity,
    cash,
    previousCash,
    operations,
    projects,
    crews,
    trend,
    signals,
    pipeline,
    currentWeek,
    paidDays,
    previousPaidDays,
  ] = await Promise.all([
    activityIn(company.id, range.from, range.to),
    activityIn(company.id, range.previousFrom, range.previousTo),
    moneyIn(company.id, range.from, range.to),
    moneyIn(company.id, range.previousFrom, range.previousTo),
    byOperation(company.id, range),
    byProject(company.id, range),
    byCrew(company.id, range),
    weeklyTrend(company.id, 12),
    controlSignals(company.id),
    payrollPipeline(company.id),
    (async () => {
      const week = weekRangeOf(today)
      return prisma.payrollWeek.findUnique({
        where: {
          companyId_year_weekNumber: {
            companyId: company.id,
            year: week.year,
            weekNumber: week.weekNumber,
          },
        },
      })
    })(),
    daysWithPayroll(company.id, range.from, range.to),
    daysWithPayroll(company.id, range.previousFrom, range.previousTo),
  ])

  // Solo se divide entre los días que tienen nómina calculada. Mezclar el
  // dinero de una semana con los días de tres meses da una cifra falsa.
  const costPerDay = paidDays > 0 ? cash.net / paidDays : 0
  const previousCostPerDay = previousPaidDays > 0 ? previousCash.net / previousPaidDays : 0
  const attendance =
    activity.days + activity.noWorkDays > 0
      ? (activity.days / (activity.days + activity.noWorkDays)) * 100
      : 0
  const previousAttendance =
    previousActivity.days + previousActivity.noWorkDays > 0
      ? (previousActivity.days / (previousActivity.days + previousActivity.noWorkDays)) * 100
      : 0

  const pendingAttention =
    signals.criticalExceptions + signals.workersWithoutRate + signals.unconfirmedRules

  return (
    <>
      <PageHeader
        title="Números"
        subtitle={`${company.legalName} · ${range.from} → ${range.to}`}
      />

      {/* Selector de rango: el dashboard responde a lo que se pregunte */}
      <div className="mb-6 flex flex-wrap gap-1.5">
        {(Object.keys(RANGE_LABELS) as RangeKey[]).map((option) => (
          <Link
            prefetch={false}
            key={option}
            href={`/dashboard?r=${option}`}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
              option === key
                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--hover)]'
            }`}
          >
            {RANGE_LABELS[option]}
          </Link>
        ))}
      </div>

      {pendingAttention > 0 ? (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900">
          <strong>{pendingAttention} cosas necesitan atención.</strong>{' '}
          {signals.criticalExceptions > 0 ? `${signals.criticalExceptions} errores críticos · ` : ''}
          {signals.workersWithoutRate > 0 ? (
            <>
              <Link prefetch={false} href="/worker-rates" className="font-medium underline">
                {signals.workersWithoutRate} personas activas sin tarifa vigente
              </Link>
              {' · '}
            </>
          ) : (
            ''
          )}
          {signals.unconfirmedRules > 0 ? `${signals.unconfirmedRules} reglas sin confirmar` : ''}
        </div>
      ) : null}

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Días trabajados"
          value={activity.days.toLocaleString('en-US')}
          changePct={change(activity.days, previousActivity.days)}
          hint={range.comparisonLabel}
          higherIsBetter
        />
        <Kpi
          label="Personas que trabajaron"
          value={activity.people.toLocaleString('en-US')}
          changePct={change(activity.people, previousActivity.people)}
          hint={range.comparisonLabel}
        />
        <Kpi
          label="Neto calculado"
          value={`$${money(cash.net)}`}
          changePct={change(cash.net, previousCash.net)}
          hint={
            cash.payrolls === 0
              ? 'nómina sin calcular en este rango'
              : `${cash.payrolls} nóminas · ${range.comparisonLabel}`
          }
          higherIsBetter={false}
        />
        <Kpi
          label="Costo por día trabajado"
          value={costPerDay > 0 ? `$${money(costPerDay)}` : '—'}
          changePct={costPerDay > 0 ? change(costPerDay, previousCostPerDay) : undefined}
          hint={
            costPerDay > 0
              ? `sobre ${paidDays.toLocaleString('en-US')} días con nómina calculada`
              : 'requiere nómina calculada'
          }
          higherIsBetter={false}
        />
      </section>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Asistencia"
          value={`${attendance.toFixed(1)}%`}
          changePct={change(attendance, previousAttendance)}
          hint={`${activity.noWorkDays.toLocaleString('en-US')} días sin trabajar`}
          higherIsBetter
        />
        <Kpi
          label="Medios días"
          value={activity.halfDays.toLocaleString('en-US')}
          changePct={change(activity.halfDays, previousActivity.halfDays)}
          hint={range.comparisonLabel}
        />
        <Kpi
          label="Descuentos"
          value={`$${money(cash.deductions)}`}
          changePct={change(cash.deductions, previousCash.deductions)}
          hint={range.comparisonLabel}
          higherIsBetter={false}
        />
        <Kpi
          label="Días sin calcular"
          value={signals.daysNotCalculated.toLocaleString('en-US')}
          hint="registrados pero sin nómina"
          href="/payroll"
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Por unidad de negocio"
          hint="Dónde se está yendo el trabajo en este período."
        >
          <BarList
            unit=" días"
            rows={operations.map((row) => ({
              label: row.label,
              value: row.days,
              detail: `${row.people} personas · ${row.share.toFixed(1)}% del total`,
            }))}
          />
        </Panel>

        <Panel title="Tendencia de las últimas 12 semanas" hint="Días trabajados por semana.">
          <TrendBars points={trend.map((point) => ({ label: point.label, value: point.days }))} />
        </Panel>

        <Panel title="Por proyecto" hint="Los proyectos que más mano de obra consumen.">
          <BarList
            unit=" días"
            rows={projects.slice(0, 8).map((row) => ({
              label: row.label,
              value: row.days,
              detail: `${row.people} personas · ${row.share.toFixed(1)}%`,
            }))}
          />
        </Panel>

        <Panel title="Por cuadrilla" hint="Carga de trabajo de cada equipo.">
          <BarList
            unit=" días"
            rows={crews.slice(0, 8).map((row) => ({
              label: row.label,
              value: row.days,
              detail: `${row.people} personas · ${row.share.toFixed(1)}%`,
            }))}
          />
        </Panel>

        <Panel
          title="Estado de las nóminas"
          hint="En qué punto del flujo está cada una."
          action={
            currentWeek ? (
              <Link
                prefetch={false}
                href={`/payroll/${currentWeek.id}`}
                className="text-xs font-medium text-[var(--accent)] hover:underline"
              >
                Ir a la semana actual
              </Link>
            ) : (
              <Link prefetch={false} href="/payroll" className="text-xs font-medium text-[var(--accent)] hover:underline">
                Abrir la semana actual
              </Link>
            )
          }
        >
          {pipeline.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--muted)]">
              Ninguna nómina calculada todavía.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {pipeline.map((row) => (
                <li
                  key={row.status}
                  className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                >
                  <span className="font-medium">{PIPELINE_LABELS[row.status] ?? row.status}</span>
                  <span className="tabular-nums text-[var(--muted)]">
                    {row.people} pers. · ${money(row.net)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Control"
          hint="Lo que el Excel nunca pudo avisar."
          action={<Badge tone={pendingAttention > 0 ? 'warning' : 'good'}>{pendingAttention}</Badge>}
        >
          <ul className="space-y-1.5 text-sm">
            <ControlRow
              label="Errores críticos abiertos"
              value={signals.criticalExceptions}
              bad={signals.criticalExceptions > 0}
            />
            <ControlRow
              label="Pendientes de revisión"
              value={signals.reviewExceptions}
              bad={signals.reviewExceptions > 0}
            />
            <ControlRow
              label="Personas activas sin tarifa vigente"
              value={signals.workersWithoutRate}
              bad={signals.workersWithoutRate > 0}
            />
            <ControlRow
              label="Reglas de negocio sin confirmar"
              value={signals.unconfirmedRules}
              bad={signals.unconfirmedRules > 0}
            />
          </ul>
          <p className="mt-3 text-xs text-[var(--muted)]">
            Las reglas sin confirmar están en <code>docs/EXCEL_ANALYSIS.md</code>, apartado 5.
            Mientras no se confirmen, el sistema usa el valor más conservador.
          </p>
        </Panel>
      </div>
    </>
  )
}

function ControlRow({ label, value, bad }: { label: string; value: number; bad: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-1.5 last:border-0">
      <span>{label}</span>
      <span className={`tabular-nums font-semibold ${bad ? 'text-amber-700' : 'text-emerald-700'}`}>
        {value}
      </span>
    </li>
  )
}
