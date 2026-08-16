import { Button, Card, DataTable, EmptyState, Field, PageHeader } from '@/components/ui'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { createCustomer } from '@/lib/catalog/actions'

export const dynamic = 'force-dynamic'

export default async function CustomersPage() {
  const company = await getActiveCompany()
  const customers = await prisma.customer.findMany({
    where: { companyId: company.id },
    orderBy: { name: 'asc' },
    include: { _count: { select: { projects: true } } },
  })

  return (
    <>
      <PageHeader
        back={{ href: '/catalogos', label: 'Catálogos' }}
        title="Clientes"
        subtitle="Quién nos contrata y nos paga. En los Excel esta era la columna EMPRESA."
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <DataTable
          rows={customers}
          empty={<EmptyState title="Sin clientes" hint="Agrega el primero con el formulario de la derecha." />}
          columns={[
            { key: 'name', header: 'Cliente', primary: true, render: (c) => c.name },
            { key: 'code', header: 'Código', render: (c) => c.code ?? '—' },
            { key: 'projects', header: 'Proyectos', align: 'right', render: (c) => String(c._count.projects) },
            {
              key: 'discount',
              header: 'Pronto pago',
              align: 'right',
              render: (c) => (c.earlyPaymentDiscountPct ? `${c.earlyPaymentDiscountPct}%` : '—'),
            },
          ]}
        />

        <Card>
          <h2 className="text-sm font-semibold">Nuevo cliente</h2>
          <form action={createCustomer} className="mt-3 space-y-3">
            <Field label="Nombre" name="name" required placeholder="Bigham" />
            <Field label="Código" name="code" required placeholder="BIGHAM" />
            <Field
              label="Descuento pronto pago %"
              name="earlyPaymentDiscountPct"
              placeholder="1.0875"
              hint="Lo que el cliente descuenta al pagar rápido. Reduce el ingreso, no el pago al trabajador."
            />
            <Button>Guardar</Button>
          </form>
        </Card>
      </div>
    </>
  )
}
