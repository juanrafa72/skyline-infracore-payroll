import Link from 'next/link'
import { EmptyState, PageHeader, money } from '@/components/ui'
import { Kpi } from '@/components/ui/metrics'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { toIso } from '@/lib/payroll/week'
import { ApprovalPanel } from './ApprovalPanel'
import { toggleSelfApproval } from './actions'

export const dynamic = 'force-dynamic'

/** Variación contra la semana anterior a partir de la cual se destaca. */
const VARIANCE_THRESHOLD = 25

export default async function ApprovalsPage() {
  const user = await assertCan('payroll:view')
  const company = await getActiveCompany()

  const selfApprovalSetting = await prisma.companySetting.findUnique({
    where: {
      companyId_key: { companyId: company.id, key: 'workflow.allow_self_approval' },
    },
  })
  const selfApprovalOn = selfApprovalSetting?.value === 'true'

  const [pending, recipients] = await Promise.all([
    prisma.workerPayroll.findMany({
      where: { companyId: company.id, status: 'PENDING_APPROVAL' },
      include: {
        worker: true,
        payrollWeek: true,
        additions: true,
        deductions: true,
        paymentRecipient: true,
        lines: { take: 1, orderBy: { appliedRate: 'desc' } },
      },
      orderBy: [{ payrollWeek: { startDate: 'desc' } }, { worker: { displayName: 'asc' } }],
    }),
    prisma.paymentRecipient.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, taxId: true },
    }),
  ])

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
    select: {
      workerId: true,
      payrollWeekId: true,
      netPay: true,
      daysFull: true,
      // La receptora de la semana pasada se PROPONE, jamás se asigna sola (BR-181).
      paymentRecipientId: true,
      paymentRecipient: { select: { name: true, active: true } },
    },
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

    /*
     * Sugerencia de receptora: la de la semana pasada, solo si esta nómina no
     * tiene una y aquella receptora sigue activa. Es información, no decisión:
     * asignar sigue siendo un clic del aprobador.
     */
    const suggestion =
      !payroll.paymentRecipientId && previous?.paymentRecipientId && previous.paymentRecipient?.active
        ? { id: previous.paymentRecipientId, name: previous.paymentRecipient.name }
        : null

    return {
      id: payroll.id,
      workerId: payroll.workerId,
      workerName: payroll.worker.displayName,
      weekId: payroll.payrollWeekId,
      recipientId: payroll.paymentRecipientId,
      recipientName: payroll.paymentRecipient?.name ?? null,
      suggestedRecipientId: suggestion?.id ?? null,
      suggestedRecipientName: suggestion?.name ?? null,
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
      preparedByMe: payroll.preparedById === user.id && !selfApprovalOn,
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

  // Las semanas presentes, con su total, para dejar claro qué se está aprobando.
  const byWeek = new Map<string, { label: string; period: string; net: number; count: number }>()
  for (const row of rows) {
    const current = byWeek.get(row.weekLabel) ?? {
      label: row.weekLabel,
      period: row.period,
      net: 0,
      count: 0,
    }
    current.net += Number(row.net)
    current.count += 1
    byWeek.set(row.weekLabel, current)
  }
  const weeksInView = [...byWeek.values()]

  return (
    <>
      <PageHeader
        title="Aprobaciones"
        subtitle={`${rows.length} nómina(s) esperando · ${company.displayName}`}
      />

      {/* Qué semana se está aprobando, bien visible */}
      <div className="mb-5 rounded-xl border-2 border-[var(--accent)] bg-[var(--surface)] p-4">
        {weeksInView.map((week) => (
          <div key={week.label} className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
                Estás aprobando
              </p>
              <p className="mt-0.5 text-xl font-semibold">{week.label}</p>
              <p className="text-sm text-[var(--muted)]">{week.period}</p>
            </div>
            <div className="text-right">
              <p className="text-xl font-semibold tabular-nums">${money(week.net)}</p>
              <p className="text-sm text-[var(--muted)]">
                {week.count} persona{week.count === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        ))}
        {weeksInView.length > 1 ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Hay {weeksInView.length} semanas distintas esperando. Revisa cuál estás aprobando en
            cada línea.
          </p>
        ) : null}
      </div>

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

      {ownPrepared > 0 && !selfApprovalOn ? (
        <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm">
          <p>
            <strong>{ownPrepared} las preparaste tú.</strong> No las puedes aprobar: debe hacerlo
            otra persona. Aparecen bloqueadas.
          </p>
          {user.permissions.has('settings:manage') ? (
            <form action={toggleSelfApproval} className="mt-2">
              <input type="hidden" name="enable" value="1" />
              <button
                type="submit"
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--hover)]"
              >
                Permitir que yo mismo apruebe lo que preparo
              </button>
              <span className="ml-2 text-xs text-[var(--muted)]">
                Quedará marcado en cada nómina que pase así.
              </span>
            </form>
          ) : null}
        </div>
      ) : null}

      {selfApprovalOn ? (
        <div className="mb-5 rounded-lg border border-amber-400 bg-amber-50 p-3.5 text-sm text-amber-900">
          <p>
            <strong>Modo de una sola persona activado.</strong> Puedes aprobar lo que tú mismo
            preparaste. Cada nómina que pase así queda marcada, y el registro de auditoría lo
            anota.
          </p>
          {user.permissions.has('settings:manage') ? (
            <form action={toggleSelfApproval} className="mt-2">
              <input type="hidden" name="enable" value="0" />
              <button
                type="submit"
                className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium hover:bg-amber-100"
              >
                Volver a exigir dos personas
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {recipients.length === 0 ? (
        <div className="mb-5 rounded-lg border border-sky-300 bg-sky-50 p-3.5 text-sm text-sky-900">
          <p>
            <strong>Todavía no hay empresas receptoras.</strong> Antes de aprobar hay que decir a
            qué empresa se le transfiere el dinero de cada persona. Créala abajo con «Crear nueva
            empresa receptora»: puede ser un subcontratista, una agencia, o la persona misma.
          </p>
        </div>
      ) : null}

      <ApprovalPanel rows={rows} threshold={VARIANCE_THRESHOLD} recipients={recipients} />

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
