import Link from 'next/link'
import { PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'

export const dynamic = 'force-dynamic'

/**
 * Catálogos: todo lo que se configura una vez y casi no se vuelve a tocar.
 *
 * Existe para que el menú de la izquierda solo tenga lo de cada semana. Aquí
 * no se hace nómina: se define con qué se hace —quién trabaja, en qué
 * cuadrilla, con qué tarifa, para qué cliente—.
 */

const GRUPOS: ReadonlyArray<{
  title: string
  hint: string
  items: ReadonlyArray<{ href: string; label: string; detail: string; permission?: string }>
}> = [
  {
    title: 'La gente',
    hint: 'Quién trabaja y cuánto se le paga.',
    items: [
      {
        href: '/workers',
        label: 'Trabajadores',
        detail: 'Alta, datos, tarifas y su historia semana a semana.',
        permission: 'worker:view',
      },
      {
        href: '/worker-rates',
        label: 'Tarifas faltantes',
        detail: 'Quién no tiene tarifa que aplique. Sin ella no se puede calcular.',
        permission: 'rate:view',
      },
      {
        href: '/crews',
        label: 'Cuadrillas',
        detail: 'Los equipos de trabajo y quién es su contratista.',
        permission: 'crew:manage',
      },
      {
        href: '/contractors',
        label: 'Contratistas',
        detail: 'A quién se le paga la producción de una cuadrilla.',
        permission: 'contractor:manage',
      },
      {
        href: '/advances',
        label: 'Préstamos',
        detail: 'Adelantos y deudas, con su saldo y su recuperación.',
        permission: 'advance:view',
      },
    ],
  },
  {
    title: 'El trabajo',
    hint: 'Dónde se trabaja y con qué.',
    items: [
      {
        href: '/projects',
        label: 'Proyectos',
        detail: 'Cada día trabajado va a un proyecto: de ahí sale a quién se le factura.',
        permission: 'project:manage',
      },
      {
        href: '/customers',
        label: 'Clientes',
        detail: 'Quién nos contrata y nos paga.',
        permission: 'project:manage',
      },
      {
        href: '/equipment',
        label: 'Equipos',
        detail: 'Máquinas propias y rentadas, con su costo diario y su proveedor.',
        permission: 'payroll:view',
      },
      {
        href: '/billing-rates',
        label: 'Tarifas de venta',
        detail: 'Lo que le cobramos al cliente por día o por pie construido.',
        permission: 'rate:view',
      },
    ],
  },
  {
    title: 'El dinero y el acceso',
    hint: 'Por dónde sale la plata y quién entra al sistema.',
    items: [
      {
        href: '/recipients',
        label: 'Empresas receptoras',
        detail: 'Las empresas a las que se transfiere el dinero de cada orden.',
        permission: 'payroll:approve',
      },
      {
        href: '/report-recipients',
        label: 'Envío de reportes',
        detail: 'A qué correos llega el soporte de cada pago, y qué se ha mandado.',
        permission: 'payment:view',
      },
      {
        href: '/users',
        label: 'Usuarios y roles',
        detail: 'Quién entra y qué puede hacer. Quien prepara no aprueba.',
        permission: 'user:manage',
      },
    ],
  },
]

export default async function CatalogosPage() {
  const user = await requireUser()
  const company = await getActiveCompany()

  const grupos = GRUPOS.map((grupo) => ({
    ...grupo,
    items: grupo.items.filter((item) => !item.permission || user.permissions.has(item.permission)),
  })).filter((grupo) => grupo.items.length > 0)

  return (
    <>
      <PageHeader
        title="Catálogos"
        subtitle={`Lo que se configura una vez · ${company.displayName}`}
      />

      <div className="space-y-7">
        {grupos.map((grupo) => (
          <section key={grupo.title}>
            <h2 className="text-sm font-semibold uppercase tracking-wide">{grupo.title}</h2>
            <p className="mb-3 text-xs text-[var(--muted)]">{grupo.hint}</p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {grupo.items.map((item) => (
                <Link
                  prefetch={false}
                  key={item.href}
                  href={item.href}
                  className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--accent)] hover:bg-[var(--hover)]"
                >
                  <p className="text-sm font-semibold">{item.label} →</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{item.detail}</p>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
