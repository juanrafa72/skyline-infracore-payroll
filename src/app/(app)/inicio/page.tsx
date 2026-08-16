import Link from 'next/link'
import { getActiveCompany } from '@/lib/company/context'
import { requireUser } from '@/lib/auth/rbac'
import { FlowSteps, flowSteps } from '@/components/shell/FlowSteps'
import { pendingBoard, weekFocus } from '@/lib/payroll/home'
import { toIso } from '@/lib/payroll/week'

export const dynamic = 'force-dynamic'

/**
 * Pantalla de entrada.
 *
 * Responde una sola pregunta: **¿qué tengo que hacer ahora?**
 *
 * Los números con gráficas viven aparte, para cuando alguien quiera analizar.
 * Aquí no se analiza: se trabaja. Por eso hay un paso a la vez, un botón
 * grande, y debajo todo lo que está esperando a alguien.
 *
 * Cuenta a los TRES pagables —personas, cuadrillas y equipos rentados—: si lo
 * único pendiente fuera aprobar una cuadrilla, una pantalla que solo mire
 * personas diría «la semana va al día» y nadie volvería a mirar.
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

  const focus = await weekFocus(company.id)
  const pending = await pendingBoard(company.id, focus.startDate)

  const can = (permission: string) => user.permissions.has(permission)
  const weekHref = focus.weekId ? `/payroll/${focus.weekId}` : '/payroll'

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Esta semana</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {company.displayName} · {focus.label} · del {humanDate(focus.startDate)} al{' '}
          {humanDate(focus.endDate)}
        </p>
      </header>

      {/* ── Lo que hay que hacer ahora ── */}
      <section className="rounded-xl border-2 border-[var(--accent)] bg-[var(--surface)] p-5">
        <FlowSteps current={focus.step} steps={flowSteps(user.permissions, focus.weekId)} />

        <div className="mt-5">
          {focus.step === 1 && can('payroll:create') ? (
            <Task
              title="Registrar los días de la semana"
              detail={
                focus.weekId
                  ? `Todavía no hay ningún día marcado. Tienes ${focus.activeWorkers} personas activas.`
                  : `Todavía no has abierto ninguna semana. Tienes ${focus.activeWorkers} personas activas.`
              }
              href={weekHref}
              button={focus.weekId ? 'Marcar días' : 'Abrir la semana'}
            />
          ) : null}

          {focus.step === 2 && can('payroll:create') ? (
            <Task
              /*
                Con días sin registrar, lo que sigue NO es calcular: es
                terminar de marcar. Empujar a calcular una semana a medias es
                empujar a pagar de menos.
              */
              title={focus.captura ? 'Seguir marcando los días' : 'Calcular la nómina'}
              detail={
                focus.captura
                  ? `${focus.captura} Ya marcaste los días de ${focus.peopleWithDays} persona(s).`
                  : `Ya marcaste los días de ${focus.peopleWithDays} persona(s). Ahora el sistema saca las cuentas y tú la mandas a aprobación.`
              }
              href={weekHref}
              button={focus.captura ? 'Ir a marcar' : 'Ir a calcular'}
            />
          ) : null}

          {focus.step === 3 && can('payroll:approve') ? (
            <Task
              title={`${focus.pendingApproval} liquidación(es) esperan tu aprobación`}
              detail="Personas, cuadrillas y equipos de esta semana. Revisa los números y aprueba, o devuélvelos con un comentario."
              href="/approvals"
              button="Revisar y aprobar"
              urgent
            />
          ) : null}

          {focus.step === 4 && can('payment:view') ? (
            <Task
              title={
                focus.openOrders > 0
                  ? `${focus.openOrders} orden(es) por transferir`
                  : `${focus.approvedUnpaid} pago(s) aprobados`
              }
              detail="Ya están aprobados. Falta transferir y registrar la fecha, el método y la referencia."
              href="/disbursements"
              button="Ir a pagar"
              urgent
            />
          ) : null}

          {focus.step === 5 ? (
            <Task
              title="La semana va al día"
              detail={`${focus.paid} liquidación(es) pagada(s). No hay nada pendiente de esta semana.`}
              href={focus.nextWeekStart && can('payroll:create') ? '/payroll' : weekHref}
              button={
                focus.nextWeekStart && can('payroll:create')
                  ? `Abrir la ${focus.nextWeekLabel?.toLowerCase()}`
                  : 'Ver la semana'
              }
            />
          ) : null}

          {/* Si el paso activo no es del rol de quien mira, se le dice quién sigue */}
          {(focus.step === 1 || focus.step === 2) && !can('payroll:create') ? (
            <Waiting text="Esperando a que se registren y calculen los días." />
          ) : null}
          {focus.step === 3 && !can('payroll:approve') ? (
            <Waiting
              text={`${focus.pendingApproval} liquidación(es) esperan aprobación. Le toca a quien aprueba.`}
            />
          ) : null}
          {focus.step === 4 && !can('payment:view') ? (
            <Waiting text={`${focus.approvedUnpaid} pago(s) esperan a tesorería.`} />
          ) : null}
        </div>
      </section>

      {/* ── Todo lo que está esperando a alguien ── */}
      {pending.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Pendientes
          </h2>
          <ul className="space-y-2">
            {pending.map((item) => (
              <li key={item.key}>
                <Link
                  prefetch={false}
                  href={item.href}
                  className={`flex flex-wrap items-baseline justify-between gap-2 rounded-lg border p-3 text-sm transition hover:opacity-90 ${
                    item.tone === 'critical'
                      ? 'border-red-300 bg-red-50 text-red-900'
                      : item.tone === 'warning'
                        ? 'border-amber-300 bg-amber-50 text-amber-900'
                        : 'border-[var(--border)] bg-[var(--surface)]'
                  }`}
                >
                  <span className="font-medium">{item.title} →</span>
                  <span
                    className={
                      item.tone === 'info' ? 'text-xs text-[var(--muted)]' : 'text-xs opacity-90'
                    }
                  >
                    {item.detail}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Cómo va la semana ── */}
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Cómo va {focus.label}
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Line
            label="Personas con días marcados"
            value={`${focus.peopleWithDays} de ${focus.activeWorkers}`}
          />
          <Line label="Liquidaciones calculadas" value={String(focus.calculated)} />
          <Line label="Esperando aprobación" value={String(focus.pendingApproval)} />
          <Line label="Pagadas" value={String(focus.paid)} />
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          «Liquidación» es lo que se le paga a alguien por esta semana: una persona, una cuadrilla
          (se le paga a su contratista) o un equipo rentado (a su proveedor).
        </p>
      </section>

      {/* ── Atajos ── */}
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Ir a
        </h2>
        <div className="flex flex-wrap gap-2">
          <Shortcut href="/payroll" label="Todas las semanas" />
          {can('payroll:view') ? <Shortcut href="/production" label="Producción" /> : null}
          {can('worker:view') ? <Shortcut href="/workers" label="Trabajadores" /> : null}
          {can('dashboard:view') ? <Shortcut href="/dashboard" label="Números" /> : null}
          <Shortcut href="/catalogos" label="Catálogos" />
        </div>
      </section>

      <p className="mt-6 text-xs text-[var(--muted)]">
        Hoy es {humanDate(toIso(new Date()))}. Esta pantalla se para en la última semana con
        trabajo, no en la del calendario: la nómina de una semana se hace cuando ya terminó.
      </p>
    </div>
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
  return <p className="rounded-lg bg-[var(--hover)] p-4 text-sm text-[var(--muted)]">{text}</p>
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
