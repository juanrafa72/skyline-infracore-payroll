import { Button, Card, DataTable, EmptyState, Field, PageHeader } from '@/components/ui'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { createProject } from '@/lib/catalog/actions'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const company = await getActiveCompany()
  const [projects, customers, operations] = await Promise.all([
    prisma.project.findMany({
      where: { companyId: company.id },
      orderBy: { name: 'asc' },
      include: { customer: true, operation: true },
    }),
    prisma.customer.findMany({ where: { companyId: company.id }, orderBy: { name: 'asc' } }),
    prisma.operation.findMany({ where: { companyId: company.id }, orderBy: { sortOrder: 'asc' } }),
  ])

  return (
    <>
      <PageHeader
        title="Proyectos"
        subtitle={company.displayName}
        back={{ href: '/catalogos', label: 'Catálogos' }}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <DataTable
          rows={projects}
          empty={<EmptyState title="Sin proyectos" hint="Agrega el primero con el formulario de la derecha." />}
          columns={[
            { key: 'name', header: 'Proyecto', primary: true, render: (p) => p.name },
            { key: 'code', header: 'Código', render: (p) => p.code },
            { key: 'customer', header: 'Cliente', render: (p) => p.customer?.name ?? '—' },
            { key: 'operation', header: 'Operación', render: (p) => p.operation?.name ?? '—' },
            { key: 'location', header: 'Ubicación', render: (p) => p.location ?? '—' },
          ]}
        />

        <Card>
          <h2 className="text-sm font-semibold">Nuevo proyecto</h2>
          <form action={createProject} className="mt-3 space-y-3">
            <Field label="Nombre" name="name" required placeholder="Dublin" />
            <Field label="Código" name="code" required placeholder="DUBLIN" />
            <Field
              label="Cliente"
              name="customerId"
              options={[{ value: '', label: '— ninguno —' }, ...customers.map((c) => ({ value: c.id, label: c.name }))]}
            />
            <Field
              label="Operación"
              name="operationId"
              options={[{ value: '', label: '— ninguna —' }, ...operations.map((o) => ({ value: o.id, label: o.name }))]}
            />
            <Field label="Ubicación" name="location" placeholder="Dublin, GA" />
            <Button>Guardar</Button>
          </form>
        </Card>
      </div>
    </>
  )
}
