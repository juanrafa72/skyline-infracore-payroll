import Link from 'next/link'
import { Badge, PageHeader } from '@/components/ui'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { FORMA_PAGO, TIPO_TARIFA, label } from '@/lib/payroll/labels'
import { ratesStatus } from '@/lib/payroll/rates-status/service'
import { weekStartOf } from '@/lib/payroll/week'
import { RatesForm, type MissingRow } from './RatesForm'

export const dynamic = 'force-dynamic'

/**
 * Tarifas faltantes.
 *
 * Una sola persona sin tarifa bloquea el envío de su semana entera, así que
 * esta pantalla existe para una cosa: ver de un vistazo a quiénes les falta y
 * llenarlas todas seguidas, sin entrar ficha por ficha.
 */
export default async function WorkerRatesPage() {
  const user = await assertCan('rate:view')
  const company = await getActiveCompany()

  const today = new Date().toISOString().slice(0, 10)
  const status = await ratesStatus(company.id, today)

  const canManage = user.permissions.has('rate:manage')
  const withRate = status.needsRate.length - status.missing.length

  const rows: MissingRow[] = status.missing.map((row) => ({
    workerId: row.workerId,
    name: row.name,
    code: row.code,
    paymentLabel: label(FORMA_PAGO, row.compensationType),
    rateTypeLabel: label(TIPO_TARIFA, row.rateType),
    why: row.why ?? '',
  }))

  return (
    <>
      <PageHeader
        title="Tarifas faltantes"
        subtitle={`${company.displayName} · una persona sin tarifa bloquea el envío de su semana completa`}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={status.missing.length > 0 ? 'critical' : 'good'}>
          {status.missing.length === 0
            ? 'Nadie está bloqueando'
            : `${status.missing.length} persona(s) sin tarifa`}
        </Badge>
        <span className="text-[var(--muted)]">
          {withRate} con tarifa al día · se evalúa igual que el cálculo real (vigencia a hoy,
          proyecto y operación de cada persona)
        </span>
      </div>

      {status.missing.length === 0 ? (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          Todas las personas activas que llevan tarifa la tienen vigente. Las tarifas amarradas a
          un proyecto o turno específico se manejan en la ficha de cada persona, en{' '}
          <Link prefetch={false} href="/workers" className="underline">
            Mi gente
          </Link>
          .
        </p>
      ) : (
        <RatesForm rows={rows} defaultFrom={weekStartOf(today)} canManage={canManage} />
      )}

      {/*
        Las que se pusieron en $1 solo para destrabar.
        Van ARRIBA de todo lo demás y en rojo: ya no bloquean nada —para eso se
        pusieron— pero $1 no es la tarifa de nadie, y quien se quede así cobra
        $5 por una semana en vez de $650 sin que ningún error lo avise.
      */}
      {status.provisional.length > 0 ? (
        <section className="mt-8 rounded-lg border-2 border-red-300 bg-red-50 p-4">
          <h2 className="text-sm font-semibold text-red-900">
            {status.provisional.length} persona(s) con tarifa PROVISIONAL de $1
          </h2>
          <p className="mt-1 text-sm text-red-800">
            Se puso $1 para poder seguir trabajando, pero <strong>no es su tarifa</strong>. Si se
            calcula una semana así, esa persona cobra <strong>$5 por 5 días</strong> en vez de lo
            que le toca. Cámbialas arriba antes de aprobar.
          </p>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {status.provisional.map((person) => (
              <li
                key={person.workerId}
                className="rounded border border-red-300 bg-white px-2 py-1 text-xs"
              >
                {person.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {status.nonRateBased.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-1 text-sm font-semibold">
            No llevan tarifa de costo ({status.nonRateBased.length})
          </h2>
          <p className="mb-3 text-xs text-[var(--muted)]">
            Se pagan por producción, liquidación o de forma manual. No están bloqueando nada y una
            tarifa diaria no les aplica.
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {status.nonRateBased.map((person) => (
              <li
                key={person.workerId}
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
              >
                {person.name}
                <span className="text-[var(--muted)]">
                  {' '}
                  · {label(FORMA_PAGO, person.compensationType).toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-8 text-xs text-[var(--muted)]">
        Aquí se fijan tarifas generales (aplican a cualquier proyecto y turno). Para una tarifa
        especial de un proyecto o turno, usa la ficha de la persona en{' '}
        <Link prefetch={false} href="/workers" className="underline">
          Mi gente
        </Link>
        . Cambiar una tarifa nunca toca lo ya calculado: la vieja se cierra y la nueva arranca en
        su fecha.
      </p>
    </>
  )
}
