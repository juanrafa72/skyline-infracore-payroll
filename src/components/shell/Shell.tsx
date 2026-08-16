'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { brandVariables, type Brand } from '@/lib/brand'

/*
 * El menú.
 *
 * Arriba, y solo arriba, lo que se toca CADA SEMANA, en el orden en que se
 * hace: la semana, los días, la producción, aprobar, pagar. Todo lo que se
 * toca una vez al mes —gente, cuadrillas, proyectos, clientes, tarifas— vive
 * detrás de una sola puerta, «Catálogos».
 *
 * Antes eran veinte entradas en tres grupos y lo diario competía con lo que
 * casi nunca se abre; encontrar el paso siguiente costaba más que hacerlo.
 *
 * La etiqueta de cada ítem es EL MISMO texto que el título de su pantalla. Si
 * el menú dice una palabra y la pantalla otra, uno cree que se equivocó de
 * sitio.
 */
const NAV: ReadonlyArray<{
  group: string
  items: ReadonlyArray<{ href: string; label: string; permission?: string }>
}> = [
  {
    group: 'Cada semana',
    items: [
      { href: '/inicio', label: 'Esta semana' },
      { href: '/payroll', label: 'Nómina' },
      { href: '/production', label: 'Producción', permission: 'payroll:view' },
      /*
        Las cuadrillas van por SU semana, no por la de la gente: la nómina
        puede ir en la 33 mientras Hugo se liquida por la 25. Por eso tienen
        pantalla propia y no viven solo dentro de la semana.
      */
      { href: '/liquidar-cuadrillas', label: 'Liquidar cuadrillas', permission: 'payroll:view' },
      { href: '/approvals', label: 'Aprobar', permission: 'payroll:approve' },
      { href: '/disbursements', label: 'Pagar', permission: 'payment:view' },
      // Va aquí, no en Catálogos: un aviso sin cerrar frena el pago de alguien
      // esta misma semana, y hasta que no hubo dónde cerrarlos la nómina se
      // quedaba trancada sin salida.
      { href: '/avisos', label: 'Avisos', permission: 'payroll:view' },
    ],
  },
  {
    group: 'Consultar',
    items: [
      { href: '/dashboard', label: 'Números', permission: 'dashboard:view' },
      // Qué se pagó, a quién, cuándo y cómo — la trazabilidad que pidió el
      // negocio para tener control de lo que ya salió del banco.
      { href: '/historico', label: 'Histórico de pagos', permission: 'payment:view' },
      // Con qué se mandó cada semana a aprobación, y por cuánto. Se cita por
      // número cuando quien prepara y quien aprueba hablan de una semana.
      { href: '/resumen', label: 'Resúmenes para aprobación', permission: 'payroll:view' },
      { href: '/margin', label: 'Rentabilidad', permission: 'dashboard:view' },
      { href: '/reports', label: 'Reportes', permission: 'payroll:view' },
    ],
  },
  {
    group: 'Configurar',
    items: [
      { href: '/catalogos', label: 'Catálogos' },
      // Debajo de Catálogos, como lo pidió el negocio: la hoja de siempre,
      // para revisar lo capturado en semanas anteriores.
      { href: '/base', label: 'Base', permission: 'payroll:view' },
    ],
  },
]

export function Shell({
  companies,
  active,
  user,
  canSwitchCompany,
  permissions,
  brand,
  children,
}: {
  companies: ReadonlyArray<{ id: string; displayName: string }>
  active: { id: string; displayName: string }
  user: { name: string; roles: readonly string[] }
  canSwitchCompany: boolean
  permissions: readonly string[]
  brand: Brand
  children: React.ReactNode
}) {
  const allowed = new Set(permissions)
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <div
      className="flex min-h-screen flex-col lg:flex-row"
      style={brandVariables(brand) as React.CSSProperties}
    >
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
        {brand.logo ? (
          <Image
            src={brand.logo}
            alt={brand.logoAlt}
            width={brand.logoWidth}
            height={brand.logoHeight}
            priority
            className="h-7 w-auto"
          />
        ) : (
          <span className="truncate text-sm font-semibold">{active.displayName}</span>
        )}
      </header>

      <aside
        className={`${open ? 'block' : 'hidden'} shrink-0 border-b border-[var(--border)] bg-[var(--surface)] lg:block lg:w-60 lg:border-b-0 lg:border-r`}
      >
        <div className="hidden px-4 py-5 lg:block">
          {brand.logo ? (
            <>
              <Image
                src={brand.logo}
                alt={brand.logoAlt}
                width={brand.logoWidth}
                height={brand.logoHeight}
                priority
                className="h-9 w-auto"
              />
              <p className="brand-label mt-2.5 text-[var(--muted)]">Nómina y pagos</p>
            </>
          ) : (
            <>
              <p className="brand-display text-base">Nómina</p>
              <p className="brand-label mt-1 text-[var(--muted)]">Skyline · Infracore</p>
            </>
          )}
        </div>

        <div className="px-3 py-3 lg:pt-0">
          {canSwitchCompany && companies.length > 1 ? (
            <CompanySwitcher companies={companies} active={active} />
          ) : (
            <div className="rounded-md border border-[var(--border)] px-2.5 py-1.5">
              <p className="brand-label text-[var(--muted)]">Compañía</p>
              <p className="text-sm font-medium">{active.displayName}</p>
            </div>
          )}
        </div>

        <nav className="px-2 pb-6">
          {NAV.map((section) => (
            <div key={section.group} className="mb-4">
              <p className="brand-label px-2 pb-1.5 text-[var(--muted)]">{section.group}</p>
              <ul>
                {section.items
                  .filter((item) => !item.permission || allowed.has(item.permission))
                  .map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                  return (
                    <li key={item.href}>
                      <Link
                        prefetch={false}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={`block rounded-md px-2 py-1.5 text-sm transition ${
                          isActive
                            ? 'brand-gradient font-medium text-white shadow-sm'
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

        <div className="border-t border-[var(--border)] px-3 py-3">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-[var(--muted)]">
            {user.roles.map((role) => ROLE_LABELS[role] ?? role).join(' · ') || 'sin rol'}
          </p>
          <form action="/api/auth/logout" method="post" className="mt-2">
            <button
              type="submit"
              className="w-full rounded-md border border-[var(--border)] px-2 py-1.5 text-xs hover:bg-[var(--hover)]"
            >
              Salir
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  )
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Administrador',
  PAYROLL_PREPARER: 'Prepara nómina',
  PAYROLL_APPROVER: 'Aprueba nómina',
  TREASURY: 'Tesorería',
  AUDITOR: 'Auditor',
}

function CompanySwitcher({
  companies,
  active,
}: {
  companies: ReadonlyArray<{ id: string; displayName: string }>
  active: { id: string }
}) {
  return (
    <form action="/api/company" method="post">
      <label className="brand-label mb-1 block text-[var(--muted)]">Compañía</label>
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
