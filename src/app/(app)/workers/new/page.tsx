import Link from 'next/link'
import { Button, Card, Field, PageHeader } from '@/components/ui'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { createWorker } from '../actions'

export const dynamic = 'force-dynamic'

export default async function NewWorkerPage() {
  const company = await getActiveCompany()
  const [operations, crews, count] = await Promise.all([
    prisma.operation.findMany({ where: { companyId: company.id }, orderBy: { sortOrder: 'asc' } }),
    prisma.crew.findMany({ where: { companyId: company.id, active: true }, orderBy: { name: 'asc' } }),
    prisma.worker.count({ where: { companyId: company.id } }),
  ])

  return (
    <>
      <PageHeader title="Nuevo trabajador" subtitle={company.displayName} />

      <Card className="max-w-2xl">
        <form action={createWorker} className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" name="firstName" required />
          <Field label="Apellido" name="lastName" required />
          <Field
            label="Código"
            name="code"
            required
            defaultValue={`W-${String(count + 1).padStart(4, '0')}`}
            hint="Identificador interno, único en la compañía."
          />
          <Field
            label="Tipo de persona"
            name="personType"
            options={[
              { value: 'EMPLOYEE', label: 'Empleado' },
              { value: 'CONTRACTOR_MEMBER', label: 'Trabajador de contratista' },
              { value: 'ADMINISTRATIVE', label: 'Administrativo' },
              { value: 'SUBCONTRACTOR', label: 'Subcontratista' },
            ]}
          />
          <Field
            label="Se le paga por"
            name="compensationType"
            options={[
              { value: 'DAILY_RATE', label: 'Día trabajado' },
              { value: 'HOURLY', label: 'Hora' },
              { value: 'FIXED_WEEKLY', label: 'Semanal fijo' },
              { value: 'PRODUCTION', label: 'Producción' },
              { value: 'PIECE_RATE', label: 'Por pieza' },
              { value: 'PERCENTAGE', label: 'Porcentaje' },
            ]}
          />
          <Field
            label="Operación"
            name="operationId"
            options={[
              { value: '', label: '— ninguna —' },
              ...operations.map((o) => ({ value: o.id, label: o.name })),
            ]}
          />
          <Field
            label="Cuadrilla"
            name="crewId"
            options={[
              { value: '', label: '— ninguna —' },
              ...crews.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Field label="Teléfono" name="phone" />

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="isOnFormalPayroll" className="h-4 w-4" />
            Está en nómina formal (payroll)
          </label>

          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 sm:col-span-2">
            La tarifa se agrega después, con su fecha de vigencia. Así una nómina vieja nunca
            cambia porque hoy se modifique la tarifa.
          </p>

          <div className="flex gap-2 sm:col-span-2">
            <Button>Guardar</Button>
            <Link
              href="/workers"
              className="inline-flex h-9 items-center rounded-md border border-[var(--border)] px-3.5 text-sm font-medium"
            >
              Cancelar
            </Link>
          </div>
        </form>
      </Card>
    </>
  )
}
