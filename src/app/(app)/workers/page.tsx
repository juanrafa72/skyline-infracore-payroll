import { Badge, DataTable, EmptyState, LinkButton, PageHeader, money } from '@/components/ui'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

const PERSON_LABEL: Record<string, string> = {
  EMPLOYEE: 'Empleado',
  CONTRACTOR_MEMBER: 'De contratista',
  ADMINISTRATIVE: 'Administrativo',
  SUBCONTRACTOR: 'Subcontratista',
}

const COMP_LABEL: Record<string, string> = {
  DAILY_RATE: 'Día',
  HOURLY: 'Hora',
  FIXED_WEEKLY: 'Semanal fijo',
  PRODUCTION: 'Producción',
  PIECE_RATE: 'Por pieza',
  PERCENTAGE: 'Porcentaje',
  CONTRACTOR_SETTLEMENT: 'Liquidación',
  MANUAL: 'Manual',
}

export default async function WorkersPage() {
  const company = await getActiveCompany()
  const workers = await prisma.worker.findMany({
    where: { companyId: company.id },
    orderBy: { displayName: 'asc' },
    include: {
      rates: { where: { active: true }, orderBy: { effectiveFrom: 'desc' } },
    },
  })

  return (
    <>
      <PageHeader
        title="Trabajadores"
        subtitle={`${workers.length} en ${company.displayName}`}
        action={<LinkButton href="/workers/new">Nuevo trabajador</LinkButton>}
      />

      <DataTable
        rows={workers}
        href={(worker) => `/workers/${worker.id}`}
        empty={
          <EmptyState
            title="Todavía no hay trabajadores"
            hint="Agrega el primero para poder registrar días y calcular nómina."
            action={<LinkButton href="/workers/new">Nuevo trabajador</LinkButton>}
          />
        }
        columns={[
          { key: 'name', header: 'Nombre', primary: true, render: (w) => w.displayName },
          { key: 'code', header: 'Código', render: (w) => w.code },
          { key: 'type', header: 'Tipo', render: (w) => PERSON_LABEL[w.personType] ?? w.personType },
          { key: 'comp', header: 'Se paga por', render: (w) => COMP_LABEL[w.compensationType] ?? w.compensationType },
          {
            key: 'rate',
            header: 'Tarifa vigente',
            align: 'right',
            render: (w) =>
              w.rates[0] ? (
                `$${money(w.rates[0].amount)}`
              ) : (
                <Badge tone="critical">Sin tarifa</Badge>
              ),
          },
          {
            key: 'status',
            header: 'Estado',
            render: (w) =>
              w.status === 'ACTIVE' ? <Badge tone="good">Activo</Badge> : <Badge>{w.status}</Badge>,
          },
        ]}
      />
    </>
  )
}
