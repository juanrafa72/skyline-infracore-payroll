import { Badge, Card, DataTable, EmptyState, PageHeader } from '@/components/ui'
import { assertCan } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { NewUserForm } from './NewUserForm'
import { setUserStatus } from './actions'

export const dynamic = 'force-dynamic'

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Administrador',
  PAYROLL_PREPARER: 'Prepara nómina',
  PAYROLL_APPROVER: 'Aprueba nómina',
  TREASURY: 'Tesorería',
  AUDITOR: 'Auditor',
  EMPLOYEE_PORTAL: 'Portal empleado',
  CONTRACTOR_PORTAL: 'Portal contratista',
  CREW_PORTAL: 'Portal cuadrilla',
}

export default async function UsersPage() {
  const actor = await assertCan('user:manage')

  const [users, roles, companies] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: 'asc' },
      include: {
        companyRoles: {
          where: { active: true, revokedAt: null },
          include: { company: true, role: true },
        },
      },
    }),
    prisma.role.findMany({ where: { isSystem: true }, orderBy: { name: 'asc' } }),
    prisma.company.findMany({ where: { active: true }, orderBy: { displayName: 'asc' } }),
  ])

  return (
    <>
      <PageHeader
        title="Usuarios y roles"
        subtitle="Quién entra al sistema y qué puede hacer. Ningún nombre está fijo en el código."
      />

      <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <p className="font-semibold">Cómo se reparte el trabajo</p>
        <ul className="mt-2 space-y-1 text-[var(--muted)]">
          <li>
            <strong>Prepara nómina</strong> — registra días y envía a aprobación. No aprueba, no paga.
          </li>
          <li>
            <strong>Aprueba nómina</strong> — revisa y aprueba. No prepara, no paga.
          </li>
          <li>
            <strong>Tesorería</strong> — paga lo aprobado y sube el comprobante. No toca montos.
          </li>
        </ul>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Quien prepara no puede aprobar lo suyo, ni siquiera siendo administrador. Se verifica
          por persona, no por rol.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <DataTable
          rows={users}
          empty={<EmptyState title="Sin usuarios" hint="Crea el primero con el formulario." />}
          columns={[
            { key: 'name', header: 'Nombre', primary: true, render: (user) => user.name },
            { key: 'email', header: 'Correo', render: (user) => user.email },
            {
              key: 'roles',
              header: 'Rol y compañías',
              render: (user) =>
                user.companyRoles.length === 0 ? (
                  <Badge tone="critical">sin acceso</Badge>
                ) : (
                  [
                    ...new Set(
                      user.companyRoles.map(
                        (link) => `${ROLE_LABELS[link.role.code] ?? link.role.code}`,
                      ),
                    ),
                  ].join(', ') +
                  ' · ' +
                  [...new Set(user.companyRoles.map((link) => link.company.displayName))].join(', ')
                ),
            },
            {
              key: 'status',
              header: 'Estado',
              render: (user) =>
                user.status === 'ACTIVE' ? (
                  <Badge tone="good">activo</Badge>
                ) : (
                  <Badge tone="critical">{user.status.toLowerCase()}</Badge>
                ),
            },
            {
              key: 'actions',
              header: '',
              render: (user) =>
                user.id === actor.id ? (
                  <span className="text-xs text-[var(--muted)]">tú</span>
                ) : (
                  <form action={setUserStatus}>
                    <input type="hidden" name="userId" value={user.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}
                    />
                    <button
                      type="submit"
                      className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs hover:bg-[var(--hover)]"
                    >
                      {user.status === 'ACTIVE' ? 'desactivar' : 'activar'}
                    </button>
                  </form>
                ),
            },
          ]}
        />

        <Card>
          <h2 className="text-sm font-semibold">Nuevo usuario</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Se genera una contraseña temporal que se muestra una sola vez. Entrégala por un medio
            seguro.
          </p>
          <NewUserForm
            roles={roles.map((role) => ({
              id: role.id,
              label: ROLE_LABELS[role.code] ?? role.name,
            }))}
            companies={companies.map((company) => ({
              id: company.id,
              label: company.displayName,
            }))}
          />
        </Card>
      </div>
    </>
  )
}
