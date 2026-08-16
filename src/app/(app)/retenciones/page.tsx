import Link from 'next/link'
import { EmptyState, PageHeader } from '@/components/ui'
import { Kpi } from '@/components/ui/metrics'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { antiguedadEnPalabras, diasEntre, totalRetenido } from '@/lib/cobros'
import { retencionesDetalle, retencionesVivas } from '@/lib/cobros/service'
import { toDecimalString } from '@/lib/payroll/engine/money'
import { toIso } from '@/lib/payroll/week'
import { Devolucion } from './Devolucion'

export const dynamic = 'force-dynamic'

function money(valor: string): string {
  return Number(valor).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * La plata nuestra que los clientes todavía tienen.
 *
 * Rafael puso el caso exacto: «trabajamos con Bigham en Dublin y nos retienen
 * diez mil dólares hasta que el proyecto acabe, pero al mismo tiempo tenemos
 * equipos trabajando para Bigham en Chiefland donde ya no retuvieron todo lo
 * que iban a retener; entonces debe salir Bigham, proyecto Dublin, tanta
 * plata, los días y meses que llevan».
 *
 * Por eso se agrupa por cliente **y** proyecto, y no solo por cliente: un
 * total por cliente no se puede reclamar en ninguna parte, porque cada obra se
 * libera por su lado.
 */
export default async function RetencionesPage() {
  const user = await assertCan('payment:view')
  const company = await getActiveCompany()
  const hoy = toIso(new Date())

  const [grupos, detalle] = await Promise.all([
    retencionesVivas(company.id, hoy),
    retencionesDetalle(company.id),
  ])

  const total = totalRetenido(grupos)
  const masVieja = grupos[0]

  return (
    <>
      <PageHeader
        title="Retenciones"
        subtitle={`${company.displayName} · plata nuestra que todavía tienen los clientes`}
      />

      {grupos.length === 0 ? (
        <EmptyState
          title="No hay retenciones vivas"
          hint="Aparecen solas cuando se anota un descuento de tipo «Retención» en un cheque."
        />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Kpi label="Retenido hoy" value={`$${money(toDecimalString(total))}`} />
            <Kpi label="Obras con retención" value={String(grupos.length)} />
            <Kpi
              label="La más vieja"
              value={masVieja ? masVieja.antiguedad : '—'}
              hint={masVieja ? `${masVieja.customerName} · ${masVieja.projectName ?? 'sin obra'}` : undefined}
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-[var(--hover)]">
                <tr>
                  {['Cliente', 'Proyecto', 'Retenido', 'Llevan', ''].map((titulo) => (
                    <th
                      key={titulo || 'x'}
                      className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]"
                    >
                      {titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grupos.map((grupo) => (
                  <tr
                    key={`${grupo.customerId}:${grupo.projectId ?? 'sin'}`}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="px-3 py-2.5 font-medium">{grupo.customerName}</td>
                    <td className="px-3 py-2.5">
                      {grupo.projectName ?? (
                        <span className="text-amber-700">
                          sin obra — no se sabrá cuándo la devuelven
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      ${money(toDecimalString(grupo.vivo))}
                    </td>
                    <td className="px-3 py-2.5">
                      {grupo.antiguedad}
                      <span className="ml-1 text-xs text-[var(--muted)]">({grupo.dias} días)</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[var(--muted)]">
                      {grupo.cuantos} retención(es)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {detalle.length > 0 ? (
        <section className="mt-8">
          <h2 className="brand-label mb-1 text-[var(--muted)]">Una por una</h2>
          <p className="mb-3 text-sm text-[var(--muted)]">
            Cuando el cliente devuelva la retención, anótalo aquí: deja de contar como saldo vivo y
            queda el rastro de cuándo la soltaron.
          </p>

          <ul className="space-y-2">
            {detalle.map((fila) => {
              const vivo = Number(fila.amount) - Number(fila.releasedAmount)
              const desde = toIso(fila.check.receivedDate ?? fila.createdAt)
              return (
                <li
                  key={fila.id}
                  className={`rounded-lg border p-3.5 text-sm ${
                    vivo > 0
                      ? 'border-[var(--border)] bg-[var(--surface)]'
                      : 'border-emerald-200 bg-emerald-50/40'
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>
                      <strong>{fila.check.customer.name}</strong>
                      {fila.project ? ` · ${fila.project.name}` : ' · sin obra'}
                      {fila.check.reference ? (
                        <span className="ml-2 text-xs text-[var(--muted)]">
                          {fila.check.reference}
                        </span>
                      ) : null}
                    </span>
                    <span className="tabular-nums">
                      ${money(fila.amount.toFixed(2))}
                      {Number(fila.releasedAmount) > 0 ? (
                        <span className="ml-2 text-xs text-emerald-800">
                          devuelto ${money(fila.releasedAmount.toFixed(2))}
                        </span>
                      ) : null}
                    </span>
                  </div>

                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {fila.reason} · retenido desde {desde} ·{' '}
                    {antiguedadEnPalabras(diasEntre(desde, hoy))}
                  </p>

                  {vivo > 0 && user.permissions.has('payment:view') ? (
                    <Devolucion deductionId={fila.id} vivo={vivo.toFixed(2)} hoy={hoy} />
                  ) : (
                    <p className="mt-1 text-xs text-emerald-800">
                      Devuelta completa{fila.releasedAt ? ` el ${toIso(fila.releasedAt)}` : ''}.
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      <p className="mt-5 text-sm text-[var(--muted)]">
        Las retenciones salen de los descuentos anotados en{' '}
        <Link prefetch={false} href="/cheques" className="text-[var(--accent)] underline">
          Cheques
        </Link>
        .
      </p>
    </>
  )
}
