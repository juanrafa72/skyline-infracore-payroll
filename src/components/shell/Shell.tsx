'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import type { ActiveCompany } from '@/lib/company/context'

const NAV: ReadonlyArray<{ group: string; items: ReadonlyArray<{ href: string; label: string; soon?: boolean }> }> = [
  {
    group: 'Operación',
    items: [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/payroll', label: 'Nómina' },
      { href: '/reports', label: 'Reportes' },
    ],
  },
  {
    group: 'Maestros',
    items: [
      { href: '/workers', label: 'Trabajadores' },
      { href: '/contractors', label: 'Contratistas' },
      { href: '/crews', label: 'Cuadrillas' },
      { href: '/projects', label: 'Proyectos' },
      { href: '/customers', label: 'Clientes' },
    ],
  },
  {
    group: 'Pendiente',
    items: [
      { href: '/approvals', label: 'Aprobaciones', soon: true },
      { href: '/payments', label: 'Pagos', soon: true },
      { href: '/advances', label: 'Anticipos', soon: true },
      { href: '/debts', label: 'Deudas', soon: true },
      { href: '/audit', label: 'Auditoría', soon: true },
      { href: '/settings', label: 'Configuración', soon: true },
    ],
  },
]

export function Shell({
  companies,
  active,
  children,
}: {
  companies: readonly ActiveCompany[]
  active: ActiveCompany
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Barra superior móvil */}
      <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm"
          aria-expanded={open}
        >
          {open ? 'Cerrar' : 'Menú'}
        </button>
        <span className="truncate text-sm font-semibold">{active.displayName}</span>
      </header>

      <aside
        className={`${open ? 'block' : 'hidden'} shrink-0 border-b border-[var(--border)] bg-[var(--surface)] lg:block lg:w-60 lg:border-b-0 lg:border-r`}
      >
        <div className="hidden px-4 py-5 lg:block">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
            Payroll
          </p>
        </div>

        <div className="px-3 py-3 lg:pt-0">
          <CompanySwitcher companies={companies} active={active} />
        </div>

        <nav className="px-2 pb-6">
          {NAV.map((section) => (
            <div key={section.group} className="mb-4">
              <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                {section.group}
              </p>
              <ul>
                {section.items.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                  if (item.soon) {
                    return (
                      <li key={item.href}>
                        <span
                          className="flex cursor-not-allowed items-center justify-between rounded-md px-2 py-1.5 text-sm text-[var(--muted)] opacity-60"
                          title="Se construye en un módulo posterior del plan"
                        >
                          {item.label}
                          <span className="text-[10px] uppercase">pronto</span>
                        </span>
                      </li>
                    )
                  }
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={`block rounded-md px-2 py-1.5 text-sm transition ${
                          isActive
                            ? 'bg-[var(--accent)] font-medium text-white'
                            : 'hover:bg-[var(--hover)]'
                        }`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  )
}

function CompanySwitcher({
  companies,
  active,
}: {
  companies: readonly ActiveCompany[]
  active: ActiveCompany
}) {
  return (
    <form action="/api/company" method="post">
      <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Compañía</label>
      <select
        name="companyId"
        defaultValue={active.id}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm font-medium outline-none focus:border-[var(--accent)]"
      >
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.displayName}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="mt-1 text-xs underline">
          Cambiar
        </button>
      </noscript>
    </form>
  )
}
