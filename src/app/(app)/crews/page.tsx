import { Button, Card, DataTable, EmptyState, Field, PageHeader } from '@/components/ui'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { createCrew } from '@/lib/catalog/actions'

export const dynamic = 'force-dynamic'

export default async function CrewsPage() {
  const company = await getActiveCompany()
  const [crews, operations, projects] = await Promise.all([
    prisma.crew.findMany({
      where: { companyId: company.id },
      orderBy: { name: 'asc' },
      include: { operation: true, project: true, _count: { select: { memberships: true } } },
    }),
    prisma.operation.findMany({ where: { companyId: company.id }, orderBy: { sortOrder: 'asc' } }),
    prisma.project.findMany({ where: { companyId: company.id, active: true }, orderBy: { name: 'asc' } }),
  ])

  return (
    <>
      <PageHeader
        title="Cuadrillas"
        subtitle="Una cuadrilla es un equipo de trabajo, nunca una persona ni una máquina."
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <DataTable
          rows={crews}
          empty={<EmptyState title="Sin cuadrillas" hint="Agrega la primera con el formulario de la derecha." />}
          columns={[
            { key: 'name', header: 'Cuadrilla', primary: true, render: (c) => c.name },
            { key: 'code', header: 'Código', render: (c) => c.code },
            { key: 'operation', header: 'Operación', render: (c) => c.operation?.name ?? '—' },
            { key: 'project', header: 'Proyecto', render: (c) => c.project?.name ?? '—' },
            { key: 'members', header: 'Integrantes', align: 'right', render: (c) => String(c._count.memberships) },
          ]}
        />

        <Card>
          <h2 className="text-sm font-semibold">Nueva cuadrilla</h2>
          <form action={createCrew} className="mt-3 space-y-3">
            <Field label="Nombre" name="name" required placeholder="Missiles" />
            <Field label="Código" name="code" required placeholder="MISSILES" />
            <Field
              label="Operación"
              name="operationId"
              options={[{ value: '', label: '— ninguna —' }, ...operations.map((o) => ({ value: o.id, label: o.name }))]}
            />
            <Field
              label="Proyecto"
              name="projectId"
              options={[{ value: '', label: '— ninguno —' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            />
            <Button>Guardar</Button>
          </form>
        </Card>
      </div>
    </>
  )
}
