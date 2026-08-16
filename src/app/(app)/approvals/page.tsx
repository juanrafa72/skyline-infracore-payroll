import Link from 'next/link'
import { EmptyState, PageHeader, money } from '@/components/ui'
import { FlowSteps, NextStep, flowSteps } from '@/components/shell/FlowSteps'
import { Kpi } from '@/components/ui/metrics'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import {
  type Cents,
  ZERO,
  add,
  subtract,
  toCents,
  toDecimalString,
} from '@/lib/payroll/engine/money'
import { crewDetail, equipmentDetail } from '@/lib/disbursement/detail'
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

  const [pending, pendingCrews, pendingEquipment, recipients] = await Promise.all([
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
    prisma.crewPayroll.findMany({
      where: { companyId: company.id, status: 'PENDING_APPROVAL' },
      include: { payrollWeek: true, paymentRecipient: true },
      orderBy: [{ payrollWeek: { startDate: 'desc' } }, { crewNameSnapshot: 'asc' }],
    }),
    prisma.equipmentPayroll.findMany({
      where: { companyId: company.id, status: 'PENDING_APPROVAL' },
      include: { payrollWeek: true, paymentRecipient: true },
      orderBy: [{ payrollWeek: { startDate: 'desc' } }, { equipmentNameSnapshot: 'asc' }],
    }),
    prisma.paymentRecipient.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, taxId: true },
    }),
  ])

  if (pending.length === 0 && pendingCrews.length === 0 && pendingEquipment.length === 0) {
    return (
      <>
        <PageHeader title="Aprobar" subtitle={company.displayName} />
        <FlowSteps current={3} steps={flowSteps(user.permissions)} className="mb-5" />

        <EmptyState
          title="No hay nada esperando aprobación"
          hint="Cuando quien prepara envíe una semana, aparecerá aquí con el detalle para revisar."
        />
      </>
    )
  }

  // Semana anterior de cada pagable, para ver si algo se salió de lo normal.
  const weekIds = [
    ...new Set([
      ...pending.map((row) => row.payrollWeekId),
      ...pendingCrews.map((row) => row.payrollWeekId),
      ...pendingEquipment.map((row) => row.payrollWeekId),
    ]),
  ]
  const weeks = await prisma.payrollWeek.findMany({ where: { id: { in: weekIds } } })

  // El papel con el que llegó cada semana que está esperando aquí.
  const resumenes = await prisma.approvalSummary.findMany({
    where: { companyId: company.id, payrollWeekId: { in: weekIds } },
    include: { payrollWeek: { select: { weekNumber: true, label: true } } },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })
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

  /*
   * Lo mismo para las cuadrillas: receptora sugerida de la semana pasada y
   * préstamos vivos del crew o de su contratista. El préstamo es solo un
   * AVISO — el descuento automático dentro de la liquidación queda para
   * después; por ahora quien aprueba lo ve y decide.
   */
  const previousCrewPayrolls = await prisma.crewPayroll.findMany({
    where: {
      companyId: company.id,
      payrollWeekId: { in: [...previousByWeek.values()] },
      crewId: { in: pendingCrews.map((row) => row.crewId) },
    },
    select: {
      crewId: true,
      payrollWeekId: true,
      paymentRecipientId: true,
      paymentRecipient: { select: { name: true, active: true } },
    },
  })
  const previousCrewByKey = new Map(
    previousCrewPayrolls.map((row) => [`${row.payrollWeekId}:${row.crewId}`, row]),
  )

  const previousEquipmentPayrolls = await prisma.equipmentPayroll.findMany({
    where: {
      companyId: company.id,
      payrollWeekId: { in: [...previousByWeek.values()] },
      equipmentId: { in: pendingEquipment.map((row) => row.equipmentId) },
    },
    select: {
      equipmentId: true,
      payrollWeekId: true,
      paymentRecipientId: true,
      paymentRecipient: { select: { name: true, active: true } },
    },
  })
  const previousEquipmentByKey = new Map(
    previousEquipmentPayrolls.map((row) => [`${row.payrollWeekId}:${row.equipmentId}`, row]),
  )

  const crewAdvances =
    pendingCrews.length > 0
      ? await prisma.advance.findMany({
          where: {
            companyId: company.id,
            status: { not: 'CANCELLED' },
            OR: [
              { crewId: { in: pendingCrews.map((row) => row.crewId) } },
              {
                contractorId: {
                  in: pendingCrews
                    .map((row) => row.contractorId)
                    .filter((id): id is string => id !== null),
                },
              },
            ],
          },
          include: { recoveries: true },
        })
      : []

  const loanBalanceFor = (crewId: string, contractorId: string | null): string | null => {
    let balance = ZERO
    for (const advance of crewAdvances) {
      const matches =
        advance.crewId === crewId ||
        (contractorId !== null && advance.contractorId === contractorId)
      if (!matches) continue
      const amount = toCents(advance.amount.toFixed(2))
      const recovered = advance.recoveries.reduce<Cents>(
        (sum, row) => add(sum, toCents(row.amount.toFixed(2))),
        ZERO,
      )
      if (amount > recovered) balance = add(balance, subtract(amount, recovered))
    }
    if (balance === ZERO) return null
    return toDecimalString(balance)
  }

  const exceptions = await prisma.exception.findMany({
    where: {
      companyId: company.id,
      status: 'OPEN',
      entityId: {
        in: [
          ...pending.map((row) => row.id),
          ...pendingCrews.map((row) => row.id),
          ...pendingEquipment.map((row) => row.id),
        ],
      },
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

  const crewRows = [
    ...pendingCrews.map((payroll) => {
      const previousId = previousByWeek.get(payroll.payrollWeekId)
      const previous = previousId
        ? previousCrewByKey.get(`${previousId}:${payroll.crewId}`)
        : undefined
      const suggestion =
        !payroll.paymentRecipientId &&
        previous?.paymentRecipientId &&
        previous.paymentRecipient?.active
          ? { id: previous.paymentRecipientId, name: previous.paymentRecipient.name }
          : null
      const own = exceptionsByPayroll.get(payroll.id) ?? []

      return {
        kind: 'CREW' as const,
        id: payroll.id,
        name: `Cuadrilla ${payroll.crewNameSnapshot}`,
        crewLabel: payroll.crewNameSnapshot,
        payeeName: payroll.contractorNameSnapshot,
        payeeMissing: payroll.contractorId === null,
        payeeMissingLabel: 'sin contratista',
        weekId: payroll.payrollWeekId,
        weekLabel: `${payroll.payrollWeek.label} · ${payroll.payrollWeek.year}`,
        period: `${toIso(payroll.payrollWeek.startDate)} → ${toIso(payroll.payrollWeek.endDate)}`,
        detail: crewDetail(
        payroll.productionCount,
        payroll.billingModeSnapshot,
        payroll.appliedDailyRate?.toFixed(2) ?? null,
      ),
        total: payroll.productionTotal.toFixed(2),
        recipientId: payroll.paymentRecipientId,
        recipientName: payroll.paymentRecipient?.name ?? null,
        suggestedRecipientId: suggestion?.id ?? null,
        suggestedRecipientName: suggestion?.name ?? null,
        loanBalance: loanBalanceFor(payroll.crewId, payroll.contractorId),
        preparedByMe: payroll.preparedById === user.id && !selfApprovalOn,
        wasInvalidated: payroll.approvalInvalidatedAt !== null,
        exceptions: own.map((row) => ({ level: row.level, title: row.title, detail: row.detail })),
      }
    }),
    ...pendingEquipment.map((payroll) => {
      const previousId = previousByWeek.get(payroll.payrollWeekId)
      const previous = previousId
        ? previousEquipmentByKey.get(`${previousId}:${payroll.equipmentId}`)
        : undefined
      const suggestion =
        !payroll.paymentRecipientId &&
        previous?.paymentRecipientId &&
        previous.paymentRecipient?.active
          ? { id: previous.paymentRecipientId, name: previous.paymentRecipient.name }
          : null
      const own = exceptionsByPayroll.get(payroll.id) ?? []

      return {
        kind: 'EQUIPMENT' as const,
        id: payroll.id,
        name: `Equipo ${payroll.equipmentNameSnapshot}`,
        crewLabel: 'Equipo rentado',
        payeeName: payroll.vendorNameSnapshot,
        payeeMissing: payroll.vendorId === null,
        payeeMissingLabel: 'sin proveedor',
        weekId: payroll.payrollWeekId,
        weekLabel: `${payroll.payrollWeek.label} · ${payroll.payrollWeek.year}`,
        period: `${toIso(payroll.payrollWeek.startDate)} → ${toIso(payroll.payrollWeek.endDate)}`,
        detail: equipmentDetail(payroll.daysTotal, payroll.appliedDailyCost.toFixed(2)),
        total: payroll.totalAmount.toFixed(2),
        recipientId: payroll.paymentRecipientId,
        recipientName: payroll.paymentRecipient?.name ?? null,
        suggestedRecipientId: suggestion?.id ?? null,
        suggestedRecipientName: suggestion?.name ?? null,
        loanBalance: null,
        preparedByMe: payroll.preparedById === user.id && !selfApprovalOn,
        wasInvalidated: payroll.approvalInvalidatedAt !== null,
        exceptions: own.map((row) => ({ level: row.level, title: row.title, detail: row.detail })),
      }
    }),
  ]

  const totals = rows.reduce(
    (accumulator, row) => ({
      gross: accumulator.gross + Number(row.gross),
      deductions: accumulator.deductions + Number(row.deductions),
      net: accumulator.net + Number(row.net),
    }),
    { gross: 0, deductions: 0, net: 0 },
  )
  const crewTotal = crewRows.reduce((sum, row) => sum + Number(row.total), 0)

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
  for (const row of crewRows) {
    const current = byWeek.get(row.weekLabel) ?? {
      label: row.weekLabel,
      period: row.period,
      net: 0,
      count: 0,
    }
    current.net += Number(row.total)
    current.count += 1
    byWeek.set(row.weekLabel, current)
  }
  const weeksInView = [...byWeek.values()]

  return (
    <>
      <PageHeader
        title="Aprobar"
        subtitle={`${rows.length} nómina(s)${
          crewRows.length > 0 ? ` y ${crewRows.length} cuadrilla(s)/equipo(s)` : ''
        } esperando · ${company.displayName}`}
      />

      <FlowSteps current={3} steps={flowSteps(user.permissions)} className="mb-5" />

      {/*
        Con qué se mandó cada semana. Es el papel que quien prepara revisó
        antes de soltarla: tener el número a la vista permite hablar por
        teléfono sin describir la semana entera — «el RA-0007».
      */}
      {resumenes.length > 0 ? (
        <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
          <span className="brand-label text-[var(--muted)]">Se recibió con</span>
          <ul className="mt-1.5 space-y-0.5">
            {resumenes.map((resumen) => (
              <li key={resumen.id}>
                <Link
                  prefetch={false}
                  href={`/resumen/${resumen.id}`}
                  className="text-[var(--accent)] hover:underline"
                >
                  {resumen.number}
                </Link>{' '}
                · {resumen.payrollWeek.label ?? `Semana ${resumen.payrollWeek.weekNumber}`} ·{' '}
                <strong className="tabular-nums">
                  $
                  {Number(resumen.grandTotal).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>{' '}
                <span className="text-xs text-[var(--muted)]">
                  · lo mandó {resumen.preparedByName}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}


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
        <Kpi
          label={crewRows.length > 0 ? 'Personas + cuadrillas/equipos' : 'Personas'}
          value={crewRows.length > 0 ? `${rows.length} + ${crewRows.length}` : String(rows.length)}
        />
        <Kpi label="Bruto personas" value={`$${money(totals.gross)}`} />
        <Kpi label="Descuentos" value={`$${money(totals.deductions)}`} />
        <Kpi label="Total a aprobar" value={`$${money(totals.net + crewTotal)}`} />
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

      <ApprovalPanel
        rows={rows}
        crewRows={crewRows}
        threshold={VARIANCE_THRESHOLD}
        recipients={recipients}
      />

      <p className="mt-5 text-xs text-[var(--muted)]">
        Al aprobar se congela una huella de todo lo que afecta el pago. Si después alguien
        cambia días, tarifas, adicionales o descuentos, la aprobación se cae sola y vuelve aquí.{' '}
        <Link prefetch={false} href="/payroll" className="text-[var(--accent)] underline">
          Ver nóminas
        </Link>
      </p>

      <NextStep
        title="Después de aprobar"
        detail={
          user.permissions.has('payment:view')
            ? 'Cada aprobación se convierte sola en una orden de desembolso, agrupada por empresa receptora. Se transfieren y se registran en Pagar.'
            : 'Cada aprobación se convierte sola en una orden de desembolso. De ahí en adelante le toca a tesorería.'
        }
        href={user.permissions.has('payment:view') ? '/disbursements' : null}
        button="Ir a pagar"
      />
    </>
  )
}
