import Link from 'next/link'
import { Badge, DataTable, EmptyState, LinkButton, PageHeader, money } from '@/components/ui'
import { requireUser } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { ToggleWorkerActive } from './ToggleActive'

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

export default async function WorkersPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>
}) {
  const user = await requireUser()
  const company = await getActiveCompany()
  const { ver } = await searchParams

  /*
   * De entrada solo los activos.
   *
   * Al subirle la tarifa a alguien se crea una ficha nueva (JHON $100 pasa a
   * ser JHON1 $130) y la vieja se desactiva. Mostrarlas todas revuelve las dos
   * y hace fácil marcar la equivocada al armar una semana.
   */
  const verTodos = ver === 'todos'
  const workers = await prisma.worker.findMany({
    where: verTodos
      ? { companyId: company.id }
      : { companyId: company.id, status: 'ACTIVE' },
    orderBy: { displayName: 'asc' },
    include: {
      rates: { where: { active: true }, orderBy: { effectiveFrom: 'desc' } },
    },
  })

  const total = await prisma.worker.count({ where: { companyId: company.id } })
  const fuera = total - (verTodos ? total : workers.length)
  const canManage = user.permissions.has('worker:manage')

  return (
    <>
      <PageHeader
        back={{ href: '/catalogos', label: 'Catálogos' }}
        title="Trabajadores"
        subtitle={
          verTodos
            ? `${workers.length} en ${company.displayName} · incluidos los que están fuera de las listas`
            : `${workers.length} activos en ${company.displayName}`
        }
        action={<LinkButton href="/workers/new">Nuevo trabajador</LinkButton>}
      />

      {fuera > 0 || verTodos ? (
        <p className="mb-4 text-sm text-[var(--muted)]">
          {verTodos ? (
            <>
              Los que están fuera de las listas no se ofrecen al armar una semana, pero su
              historia y sus pagos siguen intactos.{' '}
              <Link prefetch={false} href="/workers" className="underline">
                Ver solo los activos
              </Link>
            </>
          ) : (
            <>
              Hay <strong>{fuera}</strong> persona(s) fuera de las listas (tarifas viejas, gente
              que ya no trabaja). Su historia se conserva.{' '}
              <Link prefetch={false} href="/workers?ver=todos" className="underline">
                Verlos
              </Link>
            </>
          )}
        </p>
      ) : null}

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
              w.status === 'ACTIVE' ? (
                <Badge tone="good">En las listas</Badge>
              ) : (
                <Badge>Fuera de las listas</Badge>
              ),
          },
          {
            key: 'toggle',
            header: '',
            render: (w) =>
              canManage ? (
                <ToggleWorkerActive
                  workerId={w.id}
                  name={w.displayName}
                  active={w.status === 'ACTIVE'}
                />
              ) : null,
          },
        ]}
      />
    </>
  )
}
