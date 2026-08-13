import Link from 'next/link'
import { EmptyState, PageHeader, money } from '@/components/ui'
import { Kpi } from '@/components/ui/metrics'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { toIso } from '@/lib/payroll/week'
import { ApprovalPanel } from './ApprovalPanel'

export const dynamic = 'force-dynamic'

/** Variación contra la semana anterior a partir de la cual se destaca. */
const VARIANCE_THRESHOLD = 25

export default async function ApprovalsPage() {
  const user = await assertCan('payroll:view')
  const company = await getActiveCompany()

  const pending = await prisma.workerPayroll.findMany({
    where: { companyId: company.id, status: 'PENDING_APPROVAL' },
    include: {
      worker: true,
      payrollWeek: true,
      additions: true,
      deductions: true,
      lines: { take: 1, orderBy: { appliedRate: 'desc' } },
    },
    orderBy: [{ payrollWeek: { startDate: 'desc' } }, { worker: { displayName: 'asc' } }],
  })

  if (pending.length === 0) {
    return (
      <>
        <PageHeader title="Aprobaciones" subtitle={company.displayName} />
        <EmptyState
          title="No hay nada esperando aprobación"
          hint="Cuando quien prepara envíe una semana, aparecerá aquí con el detalle para revisar."
        />
      </>
    )
  }

  // Semana anterior de cada persona, para ver si algo se salió de lo normal.
  const weekIds = [...new Set(pending.map((row) => row.payrollWeekId))]
  const weeks = await prisma.payrollWeek.findMany({ where: { id: { in: weekIds } } })
  const previousByWeek = new Map<string, string>()
  for (const week of weeks) {
    const previous = await prisma.payrollWeek.findFirst({
      where: { companyId: company.id, startDate: { lt: week.startDate }, isOffCycle: false },
      orderBy: { startDate: 'desc' },
    })
    if (previous) previousByWeek.set(week.id, previous.id)
  }

  const previousPayrolls = await prisma.workerPayroll.findMany({
    where: {
      companyId: company.id,
      payrollWeekId: { in: [...previousByWeek.values()] },
      workerId: { in: pending.map((row) => row.workerId) },
    },
    select: { workerId: true, payrollWeekId: true, netPay: true, daysFull: true },
  })
  const previousByKey = new Map(
    previousPayrolls.map((row) => [`${row.payrollWeekId}:${row.workerId}`, row]),
  )

  const exceptions = await prisma.exception.findMany({
    where: {
      companyId: company.id,
      status: 'OPEN',
      entityId: { in: pending.map((row) => row.id) },
    },
  })
  const exceptionsByPayroll = new Map<string, typeof exceptions>()
  for (const exception of exceptions) {
    const list = exceptionsByPayroll.get(exception.entityId ?? '') ?? []
    list.push(exception)
    exceptionsByPayroll.set(exception.entityId ?? '', list)
  }

  const rows = pending.map((payroll) => {
    const previousId = previousByWeek.get(payroll.payrollWeekId)
    const previous = previousId ? previousByKey.get(`${previousId}:${payroll.workerId}`) : undefined
    const previousNet = previous ? Number(previous.netPay) : null
    const net = Number(payroll.netPay)
    const changePct =
      previousNet !== null && previousNet !== 0 ? ((net - previousNet) / previousNet) * 100 : null

    const own = exceptionsByPayroll.get(payroll.id) ?? []

    return {
      id: payroll.id,
      workerName: payroll.worker.displayName,
      weekLabel: `${payroll.payrollWeek.label} · ${payroll.payrollWeek.year}`,
      period: `${toIso(payroll.payrollWeek.startDate)} → ${toIso(payroll.payrollWeek.endDate)}`,
      daysFull: payroll.daysFull,
      daysHalf: payroll.daysHalf,
      rate: payroll.lines[0] ? payroll.lines[0].appliedRate.toFixed(2) : null,
      basePay: payroll.basePay.toFixed(2),
      additions: payroll.additionsTotal.toFixed(2),
      additionDetails: payroll.additions.map(
        (row) => `${row.description} $${row.amount.toFixed(2)}`,
      ),
      deductions: payroll.deductionsTotal.toFixed(2),
      deductionDetails: payroll.deductions.map(
        (row) => `${row.description} $${row.amount.toFixed(2)}`,
      ),
      gross: payroll.grossPay.toFixed(2),
      net: payroll.netPay.toFixed(2),
      previousNet: previousNet === null ? null : previousNet.toFixed(2),
      previousDays: previous?.daysFull ?? null,
      changePct,
      isNew: previous === undefined,
      preparedByMe: payroll.preparedById === user.id,
      exceptions: own.map((row) => ({ level: row.level, title: row.title, detail: row.detail })),
      wasInvalidated: payroll.approvalInvalidatedAt !== null,
    }
  })

  const totals = rows.reduce(
    (accumulator, row) => ({
      gross: accumulator.gross + Number(row.gross),
      deductions: accumulator.deductions + Number(row.deductions),
      net: accumulator.net + Number(row.net),
    }),
    { gross: 0, deductions: 0, net: 0 },
  )

  const flagged = rows.filter(
    (row) =>
      row.exceptions.length > 0 ||
      row.isNew ||
      row.wasInvalidated ||
      (row.changePct !== null && Math.abs(row.changePct) > VARIANCE_THRESHOLD),
  ).length

  const ownPrepared = rows.filter((row) => row.preparedByMe).length

  return (
    <>
      <PageHeader
        title="Aprobaciones"
        subtitle={`${rows.length} nómina(s) esperando · ${company.displayName}`}
      />

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Personas" value={String(rows.length)} />
        <Kpi label="Bruto" value={`$${money(totals.gross)}`} />
        <Kpi label="Descuentos" value={`$${money(totals.deductions)}`} />
        <Kpi label="Neto a aprobar" value={`$${money(totals.net)}`} />
      </section>

      {flagged > 0 ? (
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900">
          <strong>{flagged} necesitan una segunda mirada.</strong> Están marcadas abajo: errores
          abiertos, personas nuevas, variación mayor a {VARIANCE_THRESHOLD}% contra la semana
          anterior, o cambios después de una aprobación previa.
        </div>
      ) : null}

      {ownPrepared > 0 ? (
        <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm">
          <strong>{ownPrepared} las preparaste tú.</strong> No las puedes aprobar: debe hacerlo
          otra persona. Aparecen bloqueadas.
        </div>
      ) : null}

      <ApprovalPanel rows={rows} threshold={VARIANCE_THRESHOLD} />

      <p className="mt-5 text-xs text-[var(--muted)]">
        Al aprobar se congela una huella de todo lo que afecta el pago. Si después alguien
        cambia días, tarifas, adicionales o descuentos, la aprobación se cae sola y vuelve aquí.{' '}
        <Link prefetch={false} href="/payroll" className="text-[var(--accent)] underline">
          Ver nóminas
        </Link>
      </p>
    </>
  )
}
