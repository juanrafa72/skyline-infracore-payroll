import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge, Button, Card, EmptyState, Field, PageHeader, money } from '@/components/ui'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { toIso } from '@/lib/payroll/week'
import {
  addCrewMember,
  createCrewPricing,
  endCrewMembership,
  setCrewShare,
  toggleInternalAccounting,
} from '../actions'

export const dynamic = 'force-dynamic'

const SHARE_LABEL: Record<string, string> = {
  PERCENTAGE: '% de lo que factura la cuadrilla',
  PER_UNIT: 'precio propio por unidad',
  FIXED_DAILY: 'monto fijo por día',
}

export default async function CrewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const company = await getActiveCompany()

  const crew = await prisma.crew.findFirst({
    where: { id, companyId: company.id },
    include: {
      operation: true,
      project: true,
      contractor: true,
      pricing: { where: { active: true }, orderBy: { effectiveFrom: 'desc' }, include: { project: true } },
      memberships: { orderBy: [{ to: 'asc' }, { from: 'desc' }], include: { worker: true } },
      shares: { where: { active: true }, orderBy: { effectiveFrom: 'desc' }, include: { worker: true } },
    },
  })
  if (!crew) notFound()

  const [projects, workers] = await Promise.all([
    prisma.project.findMany({ where: { companyId: company.id, active: true }, orderBy: { name: 'asc' } }),
    prisma.worker.findMany({
      where: { companyId: company.id, status: 'ACTIVE' },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true },
    }),
  ])

  const today = toIso(new Date())
  const activeMembers = crew.memberships.filter((membership) => !membership.to)
  const currentShares = crew.shares.filter((share) => !share.effectiveTo)
  const percentageTotal = currentShares
    .filter((share) => share.shareType === 'PERCENTAGE')
    .reduce((sum, share) => sum + Number(share.value), 0)

  return (
    <>
      <PageHeader
        title={crew.name}
        subtitle={[
          crew.code,
          crew.operation?.name,
          crew.contractor ? `subcontratista: ${crew.contractor.name}` : null,
          crew.leaderName ? `encargado: ${crew.leaderName}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Negociación ── */}
        <Card className="lg:col-span-2">
          <h2 className="text-sm font-semibold">Negociación de la cuadrilla</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Lo que se le paga por unidad producida. Ejemplo: strand $0.15 el pie, fibra $0.20 el
            pie. Cada precio lleva vigencia: cambiarlo hoy no altera lo ya liquidado.
          </p>

          {crew.pricing.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="Sin negociación registrada"
                hint="Agrega los precios acordados con esta cuadrilla."
              />
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-[var(--hover)]">
                  <tr>
                    {['Concepto', 'Precio', 'Medida', 'Proyecto', 'Desde', 'Hasta', 'Nota'].map(
                      (header) => (
                        <th
                          key={header}
                          className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]"
                        >
                          {header}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {crew.pricing.map((price) => (
                    <tr key={price.id} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2 font-medium">{price.unitLabel}</td>
                      <td className="px-3 py-2 tabular-nums">${Number(price.pricePerUnit).toFixed(4)}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">{price.unitOfMeasure}</td>
                      <td className="px-3 py-2">{price.project?.name ?? 'todos'}</td>
                      <td className="px-3 py-2 tabular-nums">{toIso(price.effectiveFrom)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {price.effectiveTo ? toIso(price.effectiveTo) : 'sin fin'}
                      </td>
                      <td className="px-3 py-2 text-[var(--muted)]">{price.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form action={createCrewPricing} className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <input type="hidden" name="crewId" value={crew.id} />
            <Field label="Concepto" name="unitLabel" required placeholder="Strand" />
            <Field label="Código" name="unitCode" required placeholder="STRAND" />
            <Field label="Precio por unidad" name="pricePerUnit" required placeholder="0.15" />
            <Field
              label="Medida"
              name="unitOfMeasure"
              options={[
                { value: 'FOOT', label: 'Pie' },
                { value: 'METER', label: 'Metro' },
                { value: 'EACH', label: 'Unidad' },
                { value: 'LOT', label: 'Lote' },
              ]}
            />
            <Field
              label="Proyecto"
              name="projectId"
              options={[
                { value: '', label: '— todos —' },
                ...projects.map((project) => ({ value: project.id, label: project.name })),
              ]}
            />
            <Field label="Desde" name="effectiveFrom" type="date" required defaultValue={today} />
            <Field label="Hasta" name="effectiveTo" type="date" hint="Vacío = sin fin" />
            <Field label="Nota" name="notes" placeholder="Acordado con el encargado" />
            <div className="sm:col-span-3 lg:col-span-4">
              <Button>Agregar precio</Button>
            </div>
          </form>
        </Card>

        {/* ── Integrantes ── */}
        <Card>
          <h2 className="text-sm font-semibold">Integrantes</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Con historial: un reporte de una semana vieja usa quiénes estaban en esa semana.
          </p>

          {crew.memberships.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">Todavía no hay integrantes.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {crew.memberships.map((membership) => (
                <li
                  key={membership.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                >
                  <span>
                    <Link
                      prefetch={false}
                      href={`/workers/${membership.workerId}`}
                      className="font-medium text-[var(--accent)] hover:underline"
                    >
                      {membership.worker.displayName}
                    </Link>
                    {membership.role === 'LEADER' ? (
                      <Badge tone="info"> encargado</Badge>
                    ) : null}
                  </span>
                  <span className="text-xs tabular-nums text-[var(--muted)]">
                    {toIso(membership.from)} → {membership.to ? toIso(membership.to) : 'hoy'}
                  </span>
                  {!membership.to ? (
                    <form action={endCrewMembership}>
                      <input type="hidden" name="membershipId" value={membership.id} />
                      <input type="hidden" name="crewId" value={crew.id} />
                      <input type="hidden" name="to" value={today} />
                      <button
                        type="submit"
                        className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted)] hover:border-red-300 hover:text-red-700"
                      >
                        sacar
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <form action={addCrewMember} className="mt-4 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="crewId" value={crew.id} />
            <div className="sm:col-span-2">
              <Field
                label="Persona"
                name="workerId"
                options={workers.map((worker) => ({ value: worker.id, label: worker.displayName }))}
              />
            </div>
            <Field
              label="Rol"
              name="role"
              options={[
                { value: 'MEMBER', label: 'Integrante' },
                { value: 'LEADER', label: 'Encargado' },
              ]}
            />
            <Field label="Desde" name="from" type="date" required defaultValue={today} />
            <div className="sm:col-span-2">
              <Button variant="secondary">Agregar integrante</Button>
            </div>
          </form>
        </Card>

        {/* ── Contabilidad interna ── */}
        <Card className={crew.tracksInternalAccounting ? 'border-[var(--accent)]' : ''}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Contabilidad interna</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Solo para las cuadrillas subcontratistas a las que además les llevamos cómo se
                reparten entre ellos. Esto <strong>no es nómina de la compañía</strong> y no genera
                pagos: es apoyo para el subcontratista.
              </p>
            </div>
            <form action={toggleInternalAccounting}>
              <input type="hidden" name="crewId" value={crew.id} />
              <input type="hidden" name="enable" value={crew.tracksInternalAccounting ? '0' : '1'} />
              <Button variant={crew.tracksInternalAccounting ? 'secondary' : 'primary'}>
                {crew.tracksInternalAccounting ? 'Desactivar' : 'Activar'}
              </Button>
            </form>
          </div>

          {!crew.tracksInternalAccounting ? (
            <p className="mt-4 rounded-md border border-dashed border-[var(--border)] p-4 text-center text-sm text-[var(--muted)]">
              Desactivado. Actívalo solo si esta cuadrilla necesita que le llevemos su reparto
              interno.
            </p>
          ) : (
            <>
              {percentageTotal > 0 ? (
                <p
                  className={`mt-3 rounded-md border p-2.5 text-xs ${
                    Math.abs(percentageTotal - 100) < 0.01
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                      : 'border-amber-300 bg-amber-50 text-amber-900'
                  }`}
                >
                  Los porcentajes suman <strong>{percentageTotal.toFixed(2)}%</strong>
                  {Math.abs(percentageTotal - 100) < 0.01
                    ? ' — cuadra.'
                    : ' — no llega a 100%. Revisa el reparto.'}
                </p>
              ) : null}

              {currentShares.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--muted)]">Sin reparto definido todavía.</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {currentShares.map((share) => (
                    <li
                      key={share.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                    >
                      <span className="font-medium">{share.worker.displayName}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {share.role ? `${share.role} · ` : ''}
                        {SHARE_LABEL[share.shareType]}
                      </span>
                      <span className="tabular-nums font-semibold">
                        {share.shareType === 'PERCENTAGE'
                          ? `${Number(share.value).toFixed(2)}%`
                          : `$${money(share.value)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <form action={setCrewShare} className="mt-4 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="crewId" value={crew.id} />
                <div className="sm:col-span-2">
                  <Field
                    label="Persona"
                    name="workerId"
                    options={
                      activeMembers.length > 0
                        ? activeMembers.map((membership) => ({
                            value: membership.workerId,
                            label: membership.worker.displayName,
                          }))
                        : workers.map((worker) => ({ value: worker.id, label: worker.displayName }))
                    }
                  />
                </div>
                <Field
                  label="Cómo se le paga"
                  name="shareType"
                  options={[
                    { value: 'PERCENTAGE', label: '% de lo que factura la cuadrilla' },
                    { value: 'PER_UNIT', label: 'Precio propio por unidad' },
                    { value: 'FIXED_DAILY', label: 'Monto fijo por día' },
                  ]}
                />
                <Field label="Valor" name="value" required placeholder="25 ó 0.05" />
                <Field label="Función" name="role" placeholder="Operador de plow" />
                <Field label="Desde" name="effectiveFrom" type="date" required defaultValue={today} />
                <div className="sm:col-span-2">
                  <Field label="Nota" name="notes" />
                </div>
                <div className="sm:col-span-2">
                  <Button variant="secondary">Guardar reparto</Button>
                </div>
              </form>
            </>
          )}
        </Card>
      </div>
    </>
  )
}
