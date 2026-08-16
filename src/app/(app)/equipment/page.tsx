import Link from 'next/link'
import { Badge, PageHeader } from '@/components/ui'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { vencimientosPendientes } from '@/lib/equipment/records-service'
import { ToggleEquipmentActive } from './ToggleActive'
import {
  EquipmentCreatePanel,
  EquipmentRowForm,
  type EquipmentListRow,
} from './EquipmentForms'

export const dynamic = 'force-dynamic'

const KIND: Record<string, string> = {
  MACHINE: 'Máquina',
  VEHICLE: 'Vehículo',
  TOOL: 'Herramienta',
}

const OWNERSHIP: Record<string, string> = {
  OWNED: 'Propio',
  RENTED: 'Rentado',
  SUBCONTRACTED: 'Subcontratado',
}

/**
 * Catálogo de equipos: máquinas y vehículos, JAMÁS personas (regla 9).
 *
 * Aquí se define lo que la semana necesita para liquidar un alquiler: si es
 * rentado, cuánto cuesta el día y QUIÉN lo cobra (el proveedor — BR-121).
 */
export default async function EquipmentPage() {
  const user = await assertCan('payroll:view')
  const company = await getActiveCompany()
  const canManage = user.permissions.has('equipment:manage')

  const hoy = new Date().toISOString().slice(0, 10)
  const [equipment, vendors, avisos] = await Promise.all([
    prisma.equipment.findMany({
      where: { companyId: company.id },
      include: { vendor: { select: { name: true } } },
      orderBy: [{ ownership: 'asc' }, { name: 'asc' }],
    }),
    prisma.vendor.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    vencimientosPendientes(company.id, hoy),
  ])

  // Cuántos documentos por atender tiene cada equipo, para verlo en la lista.
  const alertasPorEquipo = new Map<string, number>()
  for (const aviso of avisos) {
    alertasPorEquipo.set(aviso.equipmentId, (alertasPorEquipo.get(aviso.equipmentId) ?? 0) + 1)
  }

  const rows: EquipmentListRow[] = equipment.map((machine) => ({
    id: machine.id,
    code: machine.code,
    name: machine.name,
    kindLabel: KIND[machine.kind] ?? machine.kind,
    ownership: machine.ownership,
    dailyCost: machine.dailyCost ? machine.dailyCost.toFixed(2) : null,
    vendorId: machine.vendorId,
    vendorName: machine.vendor?.name ?? null,
    alertas: alertasPorEquipo.get(machine.id) ?? 0,
    active: machine.status === 'ACTIVE',
  }))

  const rented = rows.filter((row) => row.ownership === 'RENTED')
  const incomplete = rented.filter((row) => !row.dailyCost || !row.vendorId)

  return (
    <>
      <PageHeader
        back={{ href: '/catalogos', label: 'Catálogos' }}
        title="Equipos"
        subtitle={`${company.displayName} · el alquiler se le paga al proveedor del equipo, nunca al equipo`}
      />

      {incomplete.length > 0 ? (
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900">
          <strong>{incomplete.length} equipo(s) rentado(s) incompletos.</strong> Sin costo diario
          no se puede calcular su semana, y sin proveedor no se puede aprobar su pago.
        </div>
      ) : null}

      {canManage ? (
        <div className="mb-6">
          <EquipmentCreatePanel vendors={vendors} />
        </div>
      ) : null}

      <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        {rows.length === 0 ? (
          <li className="p-6 text-center text-sm text-[var(--muted)]">
            Todavía no hay equipos. Los que vengan del Excel aparecen aquí solos.
          </li>
        ) : (
          rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-[220px] flex-1">
                {/* El nombre abre la ficha: seguros, títulos y mantenimientos. */}
                <Link
                  prefetch={false}
                  href={`/equipment/${row.id}`}
                  className="text-sm font-semibold hover:underline"
                >
                  {row.name}
                </Link>
                <p className="text-xs text-[var(--muted)]">
                  {row.code} · {row.kindLabel}
                  {row.alertas > 0 ? (
                    <span className="ml-1 font-medium text-amber-700">
                      · {row.alertas} documento(s) por atender
                    </span>
                  ) : null}
                </p>
              </div>

              <Badge tone={row.ownership === 'RENTED' ? 'info' : 'neutral'}>
                {OWNERSHIP[row.ownership] ?? row.ownership}
              </Badge>

              {row.ownership === 'RENTED' && (!row.dailyCost || !row.vendorId) ? (
                <Badge tone="critical">
                  {!row.dailyCost ? 'sin costo diario' : 'sin proveedor'}
                </Badge>
              ) : null}

              {canManage ? (
                <>
                <EquipmentRowForm row={row} vendors={vendors} />
                <ToggleEquipmentActive
                  equipmentId={row.id}
                  name={row.name}
                  active={row.active}
                />
                </>
              ) : (
                <span className="text-xs text-[var(--muted)]">
                  {row.dailyCost ? `$${row.dailyCost}/día` : 'sin costo'} ·{' '}
                  {row.vendorName ?? 'sin proveedor'}
                </span>
              )}
            </li>
          ))
        )}
      </ul>

      <p className="mt-5 text-xs text-[var(--muted)]">
        Cambiar el costo diario no toca las semanas ya calculadas: cada liquidación congela el
        costo del momento, igual que las tarifas de las personas.
      </p>
    </>
  )
}
