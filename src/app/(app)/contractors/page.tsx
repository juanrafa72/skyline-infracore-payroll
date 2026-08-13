import { Badge, Button, Card, DataTable, EmptyState, Field, PageHeader, money } from '@/components/ui'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { createContractor } from './actions'

export const dynamic = 'force-dynamic'

export default async function ContractorsPage() {
  const company = await getActiveCompany()

  const contractors = await prisma.contractor.findMany({
    where: { companyId: company.id },
    orderBy: { name: 'asc' },
    include: {
      advances: { include: { recoveries: true } },
      _count: { select: { crews: true, workers: true } },
    },
  })

  const rows = contractors.map((contractor) => {
    const lent = contractor.advances.reduce((sum, advance) => sum + Number(advance.amount), 0)
    const recovered = contractor.advances.reduce(
      (sum, advance) => sum + advance.recoveries.reduce((r, row) => r + Number(row.amount), 0),
      0,
    )
    return { contractor, lent, recovered, balance: lent - recovered }
  })

  const totalOwed = rows.reduce((sum, row) => sum + row.balance, 0)

  return (
    <>
      <PageHeader
        title="Contratistas"
        subtitle={`${contractors.length} en ${company.displayName}${
          totalOwed > 0 ? ` · $${money(totalOwed)} prestados sin recuperar` : ''
        }`}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <DataTable
          rows={rows}
          href={(row) => `/contractors/${row.contractor.id}`}
          empty={
            <EmptyState
              title="Sin contratistas"
              hint="Agrega el primero con el formulario de la derecha."
            />
          }
          columns={[
            { key: 'name', header: 'Contratista', primary: true, render: (row) => row.contractor.name },
            {
              key: 'crews',
              header: 'Cuadrillas',
              align: 'right',
              render: (row) => String(row.contractor._count.crews),
            },
            { key: 'lent', header: 'Prestado', align: 'right', render: (row) => `$${money(row.lent)}` },
            {
              key: 'recovered',
              header: 'Recuperado',
              align: 'right',
              render: (row) => `$${money(row.recovered)}`,
            },
            {
              key: 'balance',
              header: 'Debe',
              align: 'right',
              render: (row) =>
                row.balance > 0 ? (
                  <span className="font-semibold text-amber-700">${money(row.balance)}</span>
                ) : (
                  <Badge tone="good">al día</Badge>
                ),
            },
          ]}
        />

        <Card>
          <h2 className="text-sm font-semibold">Nuevo contratista</h2>
          <form action={createContractor} className="mt-3 space-y-3">
            <Field label="Nombre" name="name" required placeholder="Forzo" />
            <Field label="Razón social" name="legalName" />
            <Field label="Contacto" name="contactName" />
            <Field label="Teléfono" name="phone" />
            <Field
              label="Comisión %"
              name="commissionPct"
              placeholder="2"
              hint="La comisión sobre su factura, si aplica."
            />
            <Button>Guardar</Button>
          </form>
        </Card>
      </div>
    </>
  )
}
