import Link from 'next/link'
import { getActiveCompany } from '@/lib/company/context'
import { requireUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { toIso, weekRangeOf } from '@/lib/payroll/week'

export const dynamic = 'force-dynamic'

/**
 * Pantalla de inicio.
 *
 * Responde una sola pregunta: **¿qué tengo que hacer ahora?**
 *
 * El dashboard con indicadores existe aparte, para cuando alguien quiera
 * analizar. Aquí no se analiza: se trabaja. Por eso hay un paso a la vez y un
 * botón grande, y todo lo demás está abajo.
 */

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function humanDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return `${date.getUTCDate()} de ${MONTHS[date.getUTCMonth()]}`
}

export default async function InicioPage() {
  const user = await requireUser()
  const company = await getActiveCompany()
  const range = weekRangeOf(toIso(new Date()))

  const week = await prisma.payrollWeek.findUnique({
    where: {
      companyId_year_weekNumber: {
        companyId: company.id,
        year: range.year,
        weekNumber: range.weekNumber,
      },
    },
  })

  const [activeWorkers, withDays, payrolls, waitingApproval, readyToPay, paidThisWeek] =
    await Promise.all([
      prisma.worker.count({ where: { companyId: company.id, status: 'ACTIVE' } }),
      week
        ? prisma.workEntry
            .findMany({
              where: { companyId: company.id, payrollWeekId: week.id },
              select: { workerId: true },
              distinct: ['workerId'],
            })
            .then((rows) => rows.length)
        : 0,
      week
        ? prisma.workerPayroll.count({ where: { companyId: company.id, payrollWeekId: week.id } })
        : 0,
      prisma.workerPayroll.count({
        where: { companyId: company.id, status: 'PENDING_APPROVAL' },
      }),
      prisma.workerPayroll.count({
        where: { companyId: company.id, status: { in: ['APPROVED', 'READY_TO_PAY'] } },
      }),
      week
        ? prisma.workerPayroll.count({
            where: { companyId: company.id, payrollWeekId: week.id, status: 'PAID' },
          })
        : 0,
    ])

  const can = (permission: string) => user.permissions.has(permission)

  // El paso en el que va la semana. Solo uno está activo a la vez.
  const step = withDays === 0 ? 1 : payrolls === 0 ? 2 : waitingApproval > 0 ? 3 : readyToPay > 0 ? 4 : 5

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Hola, {user.name.split(' ')[0]}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {company.displayName} · semana del {humanDate(range.startDate)} al{' '}
          {humanDate(range.endDate)}
        </p>
      </header>

      {/* ── Lo que hay que hacer ahora ── */}
      <section className="rounded-xl border-2 border-[var(--accent)] bg-[var(--surface)] p-5">
        <Steps current={step} />

        <div className="mt-5">
          {step === 1 && can('payroll:create') ? (
            <Task
              title="Registrar los días de la semana"
              detail={`Todavía no has marcado ningún día. Tienes ${activeWorkers} personas activas.`}
              href={week ? `/payroll/${week.id}` : '/payroll'}
              button="Registrar días"
            />
          ) : null}

          {step === 2 && can('payroll:create') ? (
            <Task
              title="Calcular la nómina"
              detail={`Ya marcaste los días de ${withDays} persona(s). Ahora el sistema saca las cuentas.`}
              href={week ? `/payroll/${week.id}` : '/payroll'}
              button="Ir a calcular"
            />
          ) : null}

          {step === 3 && can('payroll:approve') ? (
            <Task
              title={`${waitingApproval} nómina(s) esperan tu aprobación`}
              detail="Revisa los números y aprueba, o devuélvelos con un comentario."
              href="/approvals"
              button="Revisar y aprobar"
              urgent
            />
          ) : null}

          {step === 4 && can('payment:execute') ? (
            <Task
              title={`${readyToPay} pago(s) listos`}
              detail="Ya están aprobados. Solo falta registrar cómo se pagaron."
              href="/payments"
              button="Registrar pagos"
              urgent
            />
          ) : null}

          {step === 5 ? (
            <Task
              title="La semana va al día"
              detail={`${paidThisWeek} nómina(s) pagadas. No hay nada pendiente por ahora.`}
              href="/payroll"
              button="Ver la semana"
            />
          ) : null}

          {/* Si el paso activo no es del rol de quien mira, se le dice quién sigue */}
          {(step === 1 || step === 2) && !can('payroll:create') ? (
            <Waiting text="Esperando a que se registren y calculen los días." />
          ) : null}
          {step === 3 && !can('payroll:approve') ? (
            <Waiting text={`${waitingApproval} nómina(s) esperan aprobación. Le toca a quien aprueba.`} />
          ) : null}
          {step === 4 && !can('payment:execute') ? (
            <Waiting text={`${readyToPay} pago(s) esperan a tesorería.`} />
          ) : null}
        </div>
      </section>

      {/* ── Otras cosas pendientes, si las hay ── */}
      {waitingApproval > 0 && step !== 3 && can('payroll:approve') ? (
        <Alert
          href="/approvals"
          text={`Además, ${waitingApproval} nómina(s) de otras semanas esperan tu aprobación.`}
        />
      ) : null}
      {readyToPay > 0 && step !== 4 && can('payment:execute') ? (
        <Alert href="/payments" text={`Además, ${readyToPay} pago(s) están listos para registrar.`} />
      ) : null}

      {/* ── Cómo va la semana ── */}
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Cómo va esta semana
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Line label="Personas con días marcados" value={`${withDays} de ${activeWorkers}`} />
          <Line label="Nóminas calculadas" value={String(payrolls)} />
          <Line label="Esperando aprobación" value={String(waitingApproval)} />
          <Line label="Pagadas" value={String(paidThisWeek)} />
        </div>
      </section>

      {/* ── Atajos ── */}
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Ir a
        </h2>
        <div className="flex flex-wrap gap-2">
          <Shortcut href="/payroll" label="Nóminas de todas las semanas" />
          {can('worker:view') ? <Shortcut href="/workers" label="Mi gente" /> : null}
          {can('crew:manage') ? <Shortcut href="/crews" label="Cuadrillas" /> : null}
          {can('contractor:manage') ? <Shortcut href="/contractors" label="Contratistas" /> : null}
          {can('dashboard:view') ? <Shortcut href="/dashboard" label="Números y gráficas" /> : null}
        </div>
      </section>
    </div>
  )
}

function Steps({ current }: { current: number }) {
  const steps = ['Registrar días', 'Calcular', 'Aprobar', 'Pagar']
  return (
    <ol className="flex flex-wrap gap-2">
      {steps.map((label, index) => {
        const number = index + 1
        const done = current > number
        const active = current === number
        return (
          <li
            key={label}
            className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              active
                ? 'border-[var(--accent)] bg-[var(--accent)] font-semibold text-white'
                : done
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-[var(--border)] text-[var(--muted)]'
            }`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                active ? 'bg-white text-[var(--accent)]' : done ? 'bg-emerald-600 text-white' : 'bg-[var(--hover)]'
              }`}
            >
              {done ? '✓' : number}
            </span>
            <span className="truncate">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Task({
  title,
  detail,
  href,
  button,
  urgent,
}: {
  title: string
  detail: string
  href: string
  button: string
  urgent?: boolean
}) {
  return (
    <div>
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-1 text-sm text-[var(--muted)]">{detail}</p>
      <Link
        prefetch={false}
        href={href}
        className={`mt-4 inline-flex h-11 items-center rounded-lg px-6 text-base font-semibold text-white transition hover:opacity-90 ${
          urgent ? 'bg-amber-600' : 'bg-[var(--accent)]'
        }`}
      >
        {button} →
      </Link>
    </div>
  )
}

function Waiting({ text }: { text: string }) {
  return (
    <p className="rounded-lg bg-[var(--hover)] p-4 text-sm text-[var(--muted)]">{text}</p>
  )
}

function Alert({ href, text }: { href: string; text: string }) {
  return (
    <Link
      prefetch={false}
      href={href}
      className="mt-3 block rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 hover:bg-amber-100"
    >
      {text} →
    </Link>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  )
}

function Shortcut({ href, label }: { href: string; label: string }) {
  return (
    <Link
      prefetch={false}
      href={href}
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-sm hover:bg-[var(--hover)]"
    >
      {label}
    </Link>
  )
}
