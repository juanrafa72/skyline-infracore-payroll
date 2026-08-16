import Link from 'next/link'
import { Badge, EmptyState, PageHeader, Stat, money } from '@/components/ui'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import {
  ESTADO_ORDEN,
  MEDIO_PAGO,
  resumirHistorico,
  totalesPorReceptora,
} from '@/lib/disbursement/history'
import { historicoDePagos } from '@/lib/disbursement/history-service'

export const dynamic = 'force-dynamic'

const TIPO: Record<string, string> = {
  WORKER: 'persona',
  CREW: 'cuadrilla',
  EQUIPMENT: 'equipo',
}

/**
 * Histórico de pagos: qué se pagó, a quién, cuándo y cómo.
 *
 * El negocio lo pidió para tener control: «un dashboard donde podamos ver que
 * se ha pagado, a quién se ha pagado y cómo».
 *
 * Todo sale de los snapshots de las órdenes, no de consultas vivas: si mañana
 * cambia el nombre de una empresa receptora, el histórico sigue diciendo lo
 * que decía el día del pago.
 */
export default async function HistoricoPage({
  searchParams,
}: {
  searchParams: Promise<{
    desde?: string
    hasta?: string
    receptora?: string
    tipo?: string
    q?: string
  }>
}) {
  await assertCan('payment:view')
  const company = await getActiveCompany()
  const filtros = await searchParams

  const [filas, receptoras] = await Promise.all([
    historicoDePagos(company.id, {
      desde: filtros.desde || null,
      hasta: filtros.hasta || null,
      recipientId: filtros.receptora || null,
      kind: (filtros.tipo as 'WORKER' | 'CREW' | 'EQUIPMENT') || null,
      q: filtros.q || null,
    }),
    prisma.paymentRecipient.findMany({
      where: { companyId: company.id },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ])

  const resumen = resumirHistorico(filas)
  const porReceptora = totalesPorReceptora(filas)

  return (
    <>
      <PageHeader
        title="Histórico de pagos"
        subtitle={`${company.displayName} · qué se pagó, a quién, cuándo y cómo`}
      />

      {/* Filtros. Van en la URL para poder guardar o compartir una consulta. */}
      <form className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Desde</span>
          <input
            type="date"
            name="desde"
            defaultValue={filtros.desde ?? ''}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Hasta</span>
          <input
            type="date"
            name="hasta"
            defaultValue={filtros.hasta ?? ''}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Empresa receptora</span>
          <select
            name="receptora"
            defaultValue={filtros.receptora ?? ''}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
          >
            <option value="">Todas</option>
            {receptoras.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Qué se pagó</span>
          <select
            name="tipo"
            defaultValue={filtros.tipo ?? ''}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
          >
            <option value="">Todo</option>
            <option value="WORKER">Personas</option>
            <option value="CREW">Cuadrillas</option>
            <option value="EQUIPMENT">Equipos</option>
          </select>
        </label>
        <label className="min-w-40 flex-1 text-sm">
          <span className="mb-1 block text-[var(--muted)]">Buscar</span>
          <input
            name="q"
            defaultValue={filtros.q ?? ''}
            placeholder="nombre, empresa u orden"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
        </label>
        <button
          type="submit"
          className="brand-gradient inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white shadow-sm hover:opacity-90"
        >
          Filtrar
        </button>
        <Link
          prefetch={false}
          href="/historico"
          className="inline-flex h-9 items-center rounded-full border border-[var(--border)] px-4 text-sm hover:bg-[var(--hover)]"
        >
          Limpiar
        </Link>
      </form>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Ya salió del banco"
          value={`$${money(resumen.pagado)}`}
          tone="good"
          hint={`${resumen.ordenesPagadas} orden(es) pagada(s)`}
        />
        <Stat
          label="Falta por pagar"
          value={`$${money(resumen.pendiente)}`}
          tone={Number(resumen.pendiente) > 0 ? 'warning' : 'default'}
          hint={`${resumen.ordenesPendientes} orden(es) esperando`}
        />
        <Stat
          label="Empresas receptoras"
          value={String(resumen.receptoras)}
          hint="a las que se les transfirió"
        />
        <Stat
          label="Órdenes"
          value={String(filas.length)}
          hint={filtros.desde || filtros.hasta ? 'en el período filtrado' : 'en total'}
        />
      </div>

      {/* En qué se fue la plata: personas, cuadrillas, equipos. */}
      <section className="mb-8 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5">
          <p className="text-xs text-[var(--muted)]">A personas</p>
          <p className="text-lg font-semibold tabular-nums">
            ${money(resumen.porTipo.personas)}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5">
          <p className="text-xs text-[var(--muted)]">A contratistas (cuadrillas)</p>
          <p className="text-lg font-semibold tabular-nums">
            ${money(resumen.porTipo.cuadrillas)}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5">
          <p className="text-xs text-[var(--muted)]">A proveedores (equipos)</p>
          <p className="text-lg font-semibold tabular-nums">${money(resumen.porTipo.equipos)}</p>
        </div>
      </section>

      {filas.length === 0 ? (
        <EmptyState
          title="No hay pagos con esos filtros"
          hint="Cambia las fechas o limpia el filtro. Los pagos aparecen aquí a medida que tesorería los registra."
        />
      ) : (
        <>
          {/* A quién se le ha pagado, ordenado por lo que más pesa. */}
          <section className="mb-8">
            <h2 className="brand-label mb-3 text-[var(--muted)]">A quién se le ha pagado</h2>
            <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-[var(--hover)]">
                  <tr>
                    {['Empresa receptora', 'Órdenes', 'Pagado', 'Pendiente'].map((h, i) => (
                      <th
                        key={h}
                        className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] ${
                          i > 0 ? 'text-right' : 'text-left'
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {porReceptora.map((row) => (
                    <tr key={row.name} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2.5">
                        <span className="font-medium">{row.name}</span>
                        {row.taxId ? (
                          <span className="ml-2 text-xs text-[var(--muted)]">{row.taxId}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.ordenes}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                        ${money(row.pagado)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right tabular-nums ${
                          Number(row.pendiente) > 0 ? 'font-medium text-amber-700' : 'text-[var(--muted)]'
                        }`}
                      >
                        {Number(row.pendiente) > 0 ? `$${money(row.pendiente)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Cada orden, con lo que llevaba dentro. */}
          <section>
            <h2 className="brand-label mb-3 text-[var(--muted)]">Cada pago, uno por uno</h2>
            <ul className="space-y-3">
              {filas.map((fila) => (
                <li
                  key={fila.orderId}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-3.5">
                    <div>
                      <Link
                        prefetch={false}
                        href={`/disbursements/${fila.orderId}`}
                        className="font-medium hover:underline"
                      >
                        {fila.orderNumber}
                      </Link>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {fila.recipientName} · {fila.weekLabel} · {fila.periodStart} →{' '}
                        {fila.periodEnd}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-base font-semibold tabular-nums">
                        ${money(fila.amountPaid)}
                      </p>
                      {fila.amountPaid !== fila.totalAmount ? (
                        <p className="text-xs text-amber-700 tabular-nums">
                          de ${money(fila.totalAmount)}
                        </p>
                      ) : null}
                    </div>

                    <Badge
                      tone={
                        fila.status === 'PAID'
                          ? 'good'
                          : fila.status === 'CANCELLED'
                            ? 'neutral'
                            : 'warning'
                      }
                    >
                      {ESTADO_ORDEN[fila.status] ?? fila.status}
                    </Badge>
                  </div>

                  {/* Cómo se pagó: el «cómo» que pidió el negocio. */}
                  <p className="px-3.5 py-2 text-xs text-[var(--muted)]">
                    {fila.paymentDate ? (
                      <>
                        Pagada el <strong>{fila.paymentDate}</strong>
                        {fila.method ? ` · ${MEDIO_PAGO[fila.method] ?? fila.method}` : ''}
                        {fila.bankName ? ` · ${fila.bankName}` : ''}
                        {fila.reference ? ` · ref. ${fila.reference}` : ''}
                        {fila.paidByName ? ` · registró ${fila.paidByName}` : ''}
                      </>
                    ) : (
                      'Todavía sin pagar.'
                    )}
                    {fila.approvedByName ? ` · aprobó ${fila.approvedByName}` : ''}
                  </p>

                  {/* Contra qué se pagó: cada renglón con su detalle congelado. */}
                  <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
                    {fila.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center gap-3 px-3.5 py-2 text-sm"
                      >
                        <span className="min-w-40 flex-1">
                          {item.name}
                          <span className="ml-2 text-xs text-[var(--muted)]">
                            {TIPO[item.kind]}
                            {item.crewLabel ? ` · ${item.crewLabel}` : ''}
                          </span>
                        </span>
                        <span className="text-xs text-[var(--muted)]">{item.detail ?? '—'}</span>
                        <span className="min-w-24 text-right font-medium tabular-nums">
                          ${money(item.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  )
}
