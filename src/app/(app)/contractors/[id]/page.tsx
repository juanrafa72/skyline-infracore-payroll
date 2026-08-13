import { notFound } from 'next/navigation'
import { Badge, Button, Card, DataTable, EmptyState, Field, PageHeader, money } from '@/components/ui'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { toIso } from '@/lib/payroll/week'
import { createContractorAdvance, recordContractorRecovery } from '../actions'

export const dynamic = 'force-dynamic'

export default async function ContractorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const company = await getActiveCompany()

  const contractor = await prisma.contractor.findFirst({
    where: { id, companyId: company.id },
    include: {
      advances: { include: { recoveries: { orderBy: { recoveredAt: 'desc' } } }, orderBy: { requestDate: 'desc' } },
      crews: true,
    },
  })
  if (!contractor) notFound()

  const advances = contractor.advances.map((advance) => {
    const recovered = advance.recoveries.reduce((sum, row) => sum + Number(row.amount), 0)
    return { advance, recovered, balance: Number(advance.amount) - recovered }
  })

  const outstanding = advances.filter((row) => row.balance > 0)
  const totalOwed = outstanding.reduce((sum, row) => sum + row.balance, 0)
  const today = toIso(new Date())

  return (
    <>
      <PageHeader
        title={contractor.name}
        subtitle={`${company.displayName}${contractor.commissionPct ? ` · comisión ${contractor.commissionPct}%` : ''}`}
      />

      {totalOwed > 0 ? (
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            Debe ${money(totalOwed)} de {outstanding.length} adelanto(s)
          </p>
          <p className="mt-1 text-sm text-amber-900">
            Al liquidarle, esto va a aparecer como recordatorio. El sistema no descuenta solo:
            tú decides cuánto se le descuenta en cada pago.
          </p>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
              Préstamos y adelantos
            </h2>
            {advances.length === 0 ? (
              <EmptyState
                title="Sin préstamos registrados"
                hint="Registra aquí lo que se le adelante o preste, para que no se olvide al pagarle."
              />
            ) : (
              <ul className="space-y-3">
                {advances.map(({ advance, recovered, balance }) => (
                  <li
                    key={advance.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">
                          ${money(advance.amount)} · {toIso(advance.requestDate)}
                        </p>
                        <p className="mt-0.5 text-sm text-[var(--muted)]">{advance.reason}</p>
                      </div>
                      {balance > 0 ? (
                        <Badge tone="warning">debe ${money(balance)}</Badge>
                      ) : (
                        <Badge tone="good">recuperado</Badge>
                      )}
                    </div>

                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Prestado ${money(advance.amount)} · recuperado ${money(recovered)} · falta $
                      {money(balance)}
                    </p>

                    {advance.recoveries.length > 0 ? (
                      <ul className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
                        {advance.recoveries.map((recovery) => (
                          <li
                            key={recovery.id}
                            className="flex justify-between gap-2 text-xs text-[var(--muted)]"
                          >
                            <span>
                              {toIso(recovery.recoveredAt)}
                              {recovery.notes ? ` · ${recovery.notes}` : ''}
                            </span>
                            <span className="tabular-nums">−${money(recovery.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {balance > 0 ? (
                      <form
                        action={recordContractorRecovery}
                        className="mt-3 flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3"
                      >
                        <input type="hidden" name="advanceId" value={advance.id} />
                        <input type="hidden" name="contractorId" value={contractor.id} />
                        <div className="w-32">
                          <Field label="Descontar ahora" name="amount" required placeholder="0.00" />
                        </div>
                        <div className="min-w-[180px] flex-1">
                          <Field label="Nota" name="notes" placeholder="Se descontó de la semana 33" />
                        </div>
                        <Button variant="secondary">Registrar descuento</Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {contractor.crews.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">Sus cuadrillas</h2>
              <DataTable
                rows={contractor.crews}
                href={(crew) => `/crews/${crew.id}`}
                empty={null}
                columns={[
                  { key: 'name', header: 'Cuadrilla', primary: true, render: (crew) => crew.name },
                  { key: 'code', header: 'Código', render: (crew) => crew.code },
                ]}
              />
            </section>
          ) : null}
        </div>

        <Card>
          <h2 className="text-sm font-semibold">Registrar préstamo o adelanto</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            El monto queda congelado. Lo que se recupere después son movimientos aparte, para
            que siempre se vea cuánto se prestó y cuánto falta.
          </p>
          <form action={createContractorAdvance} className="mt-3 space-y-3">
            <input type="hidden" name="contractorId" value={contractor.id} />
            <Field label="Monto" name="amount" required placeholder="1500.00" />
            <Field label="Fecha" name="requestDate" type="date" required defaultValue={today} />
            <Field
              label="Motivo"
              name="reason"
              required
              placeholder="Adelanto para combustible"
              hint="Obligatorio: sin motivo no se guarda."
            />
            <Field
              label="Cómo se recupera"
              name="recoveryMethod"
              options={[
                { value: 'MANUAL', label: 'Manual — yo decido cada vez' },
                { value: 'FIXED_WEEKLY', label: 'Monto fijo cada período' },
                { value: 'LUMP_SUM', label: 'Todo en el próximo pago' },
              ]}
            />
            <Field label="Monto fijo (si aplica)" name="recoveryAmount" placeholder="250.00" />
            <Button>Registrar</Button>
          </form>
        </Card>
      </div>
    </>
  )
}
