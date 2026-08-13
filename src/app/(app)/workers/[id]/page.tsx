import { notFound } from 'next/navigation'
import { Badge, Button, Card, DataTable, EmptyState, Field, PageHeader, money } from '@/components/ui'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { createRate } from '../actions'
import { FORMA_PAGO, TIPO_PERSONA, TIPO_TARIFA, TURNO, label } from '@/lib/payroll/labels'

export const dynamic = 'force-dynamic'

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export default async function WorkerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const company = await getActiveCompany()

  const worker = await prisma.worker.findFirst({
    where: { id, companyId: company.id }, // el filtro de compañía evita el acceso cruzado
    include: {
      rates: { orderBy: [{ effectiveFrom: 'desc' }] },
      aliases: true,
    },
  })

  if (!worker) notFound()

  const crew = worker.defaultCrewId
    ? await prisma.crew.findUnique({ where: { id: worker.defaultCrewId } })
    : null

  const projects = await prisma.project.findMany({
    where: { companyId: company.id, active: true },
    orderBy: { name: 'asc' },
  })

  const today = isoDate(new Date())
  const activeRate = worker.rates.find(
    (rate) =>
      isoDate(rate.effectiveFrom) <= today &&
      (rate.effectiveTo === null || isoDate(rate.effectiveTo) > today),
  )

  return (
    <>
      <PageHeader
        title={worker.displayName}
        subtitle={`${worker.code} · ${company.displayName}`}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <h2 className="text-sm font-semibold">Datos</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Tipo" value={label(TIPO_PERSONA, worker.personType)} />
            <Row label="Se paga por" value={label(FORMA_PAGO, worker.compensationType)} />
            <Row label="Cuadrilla" value={crew?.name ?? '—'} />
            <Row label="Teléfono" value={worker.phone ?? '—'} />
            <Row label="Nómina formal" value={worker.isOnFormalPayroll ? 'Sí' : 'No'} />
            <Row
              label="Tarifa hoy"
              value={activeRate ? `$${money(activeRate.amount)}` : 'sin tarifa vigente'}
            />
          </dl>
          {!activeRate ? (
            <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-2.5 text-xs text-red-700">
              Sin tarifa vigente, sus días no se pueden calcular. El sistema lo marca como error
              en vez de pagarle $0 en silencio.
            </p>
          ) : null}
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="text-sm font-semibold">Agregar tarifa</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Cada tarifa tiene vigencia. Al cambiarla, cierra la anterior poniéndole fecha final;
            las nóminas ya calculadas conservan la tarifa con que se pagaron.
          </p>
          <form action={createRate} className="mt-4 grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="workerId" value={worker.id} />
            <Field
              label="Tipo"
              name="rateType"
              options={[
                { value: 'DAILY', label: 'Por día' },
                { value: 'HOURLY', label: 'Por hora' },
                { value: 'WEEKLY', label: 'Semanal fijo' },
              ]}
            />
            <Field label="Monto" name="amount" required placeholder="200.00" />
            <Field
              label="Turno"
              name="shift"
              options={[
                { value: 'ANY', label: 'Cualquiera' },
                { value: 'DAY', label: 'Día' },
                { value: 'NIGHT', label: 'Noche' },
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
            <Field label="Vigente desde" name="effectiveFrom" type="date" required defaultValue={today} />
            <Field label="Vigente hasta" name="effectiveTo" type="date" hint="Vacío = sin fin" />
            <div className="sm:col-span-3">
              <Field label="Motivo del cambio" name="sourceNote" placeholder="Aumento acordado, cambio de proyecto…" />
            </div>
            <div className="sm:col-span-3">
              <Button>Agregar tarifa</Button>
            </div>
          </form>
        </Card>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">Historial de tarifas</h2>
        <DataTable
          rows={worker.rates}
          empty={
            <EmptyState
              title="Sin tarifas registradas"
              hint="Agrega la primera con el formulario de arriba."
            />
          }
          columns={[
            {
              key: 'amount',
              header: 'Monto',
              primary: true,
              render: (rate) => `$${money(rate.amount)}`,
            },
            { key: 'type', header: 'Tipo', render: (rate) => label(TIPO_TARIFA, rate.rateType) },
            { key: 'shift', header: 'Turno', render: (rate) => label(TURNO, rate.shift) },
            { key: 'from', header: 'Desde', render: (rate) => isoDate(rate.effectiveFrom) },
            {
              key: 'to',
              header: 'Hasta',
              render: (rate) => (rate.effectiveTo ? isoDate(rate.effectiveTo) : 'sin fin'),
            },
            {
              key: 'status',
              header: 'Estado',
              render: (rate) =>
                rate.id === activeRate?.id ? <Badge tone="good">Vigente</Badge> : <Badge>Histórica</Badge>,
            },
            { key: 'note', header: 'Motivo', render: (rate) => rate.sourceNote ?? '—' },
          ]}
        />
      </section>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}
