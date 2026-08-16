import Link from 'next/link'
import { Badge, EmptyState, PageHeader } from '@/components/ui'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { CLASE_DESCUENTO } from '@/lib/cobros'
import { chequesDe } from '@/lib/cobros/service'
import { toDecimalString } from '@/lib/payroll/engine/money'
import { LoQueEntro, NuevoCheque, NuevoDescuento } from './Forms'

export const dynamic = 'force-dynamic'

function money(valor: string): string {
  return Number(valor).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Los cheques que nos pagan, y lo que nos descuentan.
 *
 * El negocio lo pidió así: se carga el valor que dice el soporte de SharePoint
 * —por una semana o varias, de un cliente—, después se digita lo que DE VERDAD
 * entró al banco, y se explica cada descuento.
 *
 * La pantalla existe para una sola pregunta: **¿falta plata por explicar?** Si
 * la diferencia se pudiera dar por buena sin escribir de qué es, la retención
 * —que vuelve— se confundiría con plata perdida y nadie la reclamaría.
 */
export default async function ChequesPage() {
  const user = await assertCan('payment:view')
  const company = await getActiveCompany()
  const puedeEditar = user.permissions.has('payment:view')

  const [cheques, customers, projects, weeks] = await Promise.all([
    chequesDe(company.id),
    prisma.customer.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.project.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.payrollWeek.findMany({
      where: { companyId: company.id, isOffCycle: false },
      orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
      take: 12,
      select: { id: true, year: true, weekNumber: true, label: true },
    }),
  ])

  return (
    <>
      <PageHeader
        title="Cheques"
        subtitle={`${company.displayName} · lo que nos pagaron y lo que nos descontaron`}
      />

      {customers.length === 0 ? (
        <EmptyState
          title="Todavía no hay clientes"
          hint="Se crean en Catálogos → Clientes. Un cheque siempre viene de alguien."
        />
      ) : (
        <>
          <NuevoCheque
            customers={customers}
            weeks={weeks.map((week) => ({
              id: week.id,
              label: `${week.label ?? `Semana ${week.weekNumber}`} · ${week.year}`,
            }))}
          />

          {cheques.length === 0 ? (
            <EmptyState
              title="Todavía no hay cheques anotados"
              hint="Anota el valor que dice el soporte; lo que entró al banco se registra después."
            />
          ) : (
            <ul className="space-y-3">
              {cheques.map((cheque) => (
                <li
                  key={cheque.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {cheque.customerName}
                        {cheque.reference ? (
                          <span className="ml-2 text-sm text-[var(--muted)]">
                            {cheque.reference}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {cheque.semanas.length > 0
                          ? `Cubre ${cheque.semanas.join(' · ')}`
                          : 'Sin semanas asignadas'}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-lg font-semibold tabular-nums">
                        ${money(cheque.expectedAmount)}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {cheque.receivedAmount
                          ? `entraron $${money(cheque.receivedAmount)}${
                              cheque.receivedDate ? ` el ${cheque.receivedDate}` : ''
                            }`
                          : 'todavía no se registra lo que entró'}
                      </p>
                    </div>
                  </div>

                  {/*
                    El cuadre, en grande: es la única pregunta que esta
                    pantalla viene a responder.
                  */}
                  {cheque.cuadre ? (
                    <div className="mt-3">
                      {cheque.cuadre.estado === 'CUADRA' ? (
                        <Badge tone="good">Cuadra</Badge>
                      ) : (
                        <p
                          className={`rounded-md border p-2.5 text-sm ${
                            cheque.cuadre.estado === 'FALTA_EXPLICAR'
                              ? 'border-amber-300 bg-amber-50 text-amber-900'
                              : 'border-red-300 bg-red-50 text-red-800'
                          }`}
                        >
                          <strong>
                            ${toDecimalString(cheque.cuadre.monto)}{' '}
                            {cheque.cuadre.estado === 'FALTA_EXPLICAR' ? 'sin explicar' : 'de más'}.
                          </strong>{' '}
                          {cheque.cuadre.mensaje}
                        </p>
                      )}
                    </div>
                  ) : null}

                  <div className="mt-3">{puedeEditar ? <LoQueEntro checkId={cheque.id} receivedAmount={cheque.receivedAmount} receivedDate={cheque.receivedDate} /> : null}</div>

                  {cheque.descuentos.length > 0 ? (
                    <ul className="mt-3 space-y-1 border-t border-[var(--border)] pt-2">
                      {cheque.descuentos.map((descuento) => (
                        <li key={descuento.id} className="flex flex-wrap justify-between gap-2 text-sm">
                          <span>
                            <strong>{CLASE_DESCUENTO[descuento.clase]}</strong>
                            {descuento.projectName ? ` · ${descuento.projectName}` : ''}
                            <span className="ml-2 text-xs text-[var(--muted)]">
                              {descuento.reason}
                            </span>
                            {Number(descuento.releasedAmount) > 0 ? (
                              <span className="ml-2 text-xs text-emerald-800">
                                devolvieron ${money(descuento.releasedAmount)}
                              </span>
                            ) : null}
                          </span>
                          <span className="tabular-nums">−${money(descuento.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {puedeEditar ? <NuevoDescuento checkId={cheque.id} projects={projects} /> : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="mt-5 text-sm text-[var(--muted)]">
        Las retenciones se siguen aparte, con su antigüedad y su obra:{' '}
        <Link prefetch={false} href="/retenciones" className="text-[var(--accent)] underline">
          ver Retenciones
        </Link>
        .
      </p>
    </>
  )
}
