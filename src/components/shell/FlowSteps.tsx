import Link from 'next/link'

/**
 * Los cuatro pasos de una semana, siempre a la vista.
 *
 * El camino son cuatro pantallas distintas —días, calcular, aprobar, pagar— y
 * cada una vivía como una isla: se terminaba un paso y había que adivinar cuál
 * seguía, o volver al menú. Esta tira va arriba de todas ellas diciendo dónde
 * está uno y dejando saltar al siguiente.
 *
 * Un paso al que la persona no puede entrar (no tiene el permiso) se ve, pero
 * no es enlace: sirve para entender el camino completo, no para chocarse con
 * una pantalla prohibida.
 */

export interface FlowStep {
  label: string
  /** `null` cuando quien mira no tiene permiso para ese paso. */
  href: string | null
}

const STEPS: ReadonlyArray<{ label: string; href: string; permission: string | null }> = [
  { label: 'Marcar días', href: '/payroll', permission: null },
  { label: 'Calcular', href: '/payroll', permission: null },
  { label: 'Aprobar', href: '/approvals', permission: 'payroll:approve' },
  { label: 'Pagar', href: '/disbursements', permission: 'payment:view' },
]

/** Los cuatro pasos, con enlace solo donde la persona sí puede entrar. */
export function flowSteps(permissions: ReadonlySet<string>, weekId?: string | null): FlowStep[] {
  return STEPS.map((step) => ({
    label: step.label,
    href:
      step.permission && !permissions.has(step.permission)
        ? null
        : step.href === '/payroll' && weekId
          ? `/payroll/${weekId}`
          : step.href,
  }))
}

/**
 * El paso siguiente, al pie de la pantalla.
 *
 * Con `href`, es un botón: se termina un paso y se sigue sin volver al menú.
 * Sin él —porque a quien mira no le toca ese paso— se dice quién sigue, que es
 * información igual de útil: nadie se queda esperando frente a una pantalla
 * que ya hizo lo suyo.
 */
export function NextStep({
  title,
  detail,
  href,
  button,
}: {
  title: string
  detail: string
  href: string | null
  button: string
}) {
  return (
    <section className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-sm text-[var(--muted)]">{detail}</p>
      {href ? (
        <Link
          prefetch={false}
          href={href}
          className="mt-3 inline-flex h-10 items-center rounded-lg bg-[var(--accent)] px-5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          {button} →
        </Link>
      ) : null}
    </section>
  )
}

export function FlowSteps({
  current,
  steps,
  className = '',
}: {
  /** 1 marcar · 2 calcular · 3 aprobar · 4 pagar · 5 todo al día. */
  current: number
  steps: readonly FlowStep[]
  className?: string
}) {
  return (
    <ol className={`flex flex-wrap gap-2 ${className}`}>
      {steps.map((step, index) => {
        const number = index + 1
        const done = current > number
        const active = current === number
        const content = (
          <>
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                active
                  ? 'bg-white text-[var(--accent)]'
                  : done
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[var(--hover)]'
              }`}
            >
              {done ? '✓' : number}
            </span>
            <span className="truncate">{step.label}</span>
          </>
        )
        const classes = `flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
          active
            ? 'border-[var(--accent)] bg-[var(--accent)] font-semibold text-white'
            : done
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-[var(--border)] text-[var(--muted)]'
        }`

        return (
          <li key={step.label} className="flex flex-1">
            {step.href ? (
              <Link prefetch={false} href={step.href} className={`${classes} hover:opacity-90`}>
                {content}
              </Link>
            ) : (
              <span className={classes} title="No tienes permiso para este paso">
                {content}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
