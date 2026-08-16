import { PageHeader } from '@/components/ui'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { TIPO_TARIFA, TURNO, label } from '@/lib/payroll/labels'
import { toIso } from '@/lib/payroll/week'
import { RateForm, type RateRow } from './RateForm'

export const dynamic = 'force-dynamic'

export default async function BillingRatesPage() {
  await assertCan('rate:view')
  const company = await getActiveCompany()

  const [rates, customers, projects, operations, crews] = await Promise.all([
    prisma.billingRate.findMany({
      where: { companyId: company.id },
      include: { customer: true, project: true, operation: true, crew: true },
      orderBy: [{ active: 'desc' }, { effectiveFrom: 'desc' }],
    }),
    prisma.customer.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { name: 'asc' },
    }),
    prisma.project.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { name: 'asc' },
    }),
    prisma.operation.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.crew.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const rows: RateRow[] = rates.map((rate) => ({
    id: rate.id,
    customer: rate.customer.name,
    amount: rate.amount.toFixed(2),
    shiftLabel: label(TURNO, rate.shift).toLowerCase(),
    typeLabel: label(TIPO_TARIFA, rate.rateType),
    scope:
      [rate.project?.name, rate.operation?.name, rate.crew?.name].filter(Boolean).join(' · ') ||
      'todo',
    from: toIso(rate.effectiveFrom),
    to: rate.effectiveTo ? toIso(rate.effectiveTo) : null,
    current: rate.active && rate.effectiveTo === null,
    sourceNote: rate.sourceNote,
  }))

  const today = new Date().toISOString().slice(0, 10)

  return (
    <>
      <PageHeader
        back={{ href: '/catalogos', label: 'Catálogos' }}
        title="Tarifas de venta"
        subtitle={`Lo que el cliente nos paga · ${company.displayName}`}
      />

      <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <p className="font-semibold">La otra mitad del negocio</p>
        <p className="mt-1 text-[var(--muted)]">
          El sistema ya sabe cuánto le <strong>cuesta</strong> cada día trabajado — eso son las
          tarifas de la gente. Aquí se dice cuánto le <strong>pagan</strong> por ese mismo día. La
          diferencia entre las dos es el margen, y sin esta mitad no se puede calcular.
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Un día solo se factura si su proyecto tiene cliente. Si un día no tiene proyecto, no hay
          a quién cobrárselo, y el margen lo dice en vez de suponerlo.
        </p>
      </div>

      {customers.length === 0 ? (
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900">
          No hay clientes cargados en {company.displayName}. Una tarifa de venta necesita saber
          quién paga: crea primero el cliente en <strong>Clientes</strong>.
        </div>
      ) : null}

      <RateForm
        customers={customers.map((row) => ({ value: row.id, label: row.name }))}
        projects={projects.map((row) => ({ value: row.id, label: row.name }))}
        operations={operations.map((row) => ({ value: row.id, label: row.name }))}
        crews={crews.map((row) => ({ value: row.id, label: row.name }))}
        rows={rows}
        today={today}
      />
    </>
  )
}
