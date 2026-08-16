import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EmptyState, LinkButton, PageHeader, Stat, money } from '@/components/ui'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { hojaDeVida } from '@/lib/equipment/records-service'
import { AddRecordForm, RecordCard, type RecordRow } from './RecordForms'

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
 * La ficha de un equipo: qué es, y su hoja de vida.
 *
 * El negocio la pidió para dos cosas: identificar cada máquina, y no volver a
 * enterarse de un seguro vencido cuando ya venció. Por eso lo primero que se
 * ve es qué está vencido o por vencer.
 */
export default async function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await assertCan('payroll:view')
  const company = await getActiveCompany()

  const machine = await prisma.equipment.findFirst({
    where: { id, companyId: company.id },
    include: {
      vendor: { select: { name: true } },
    },
  })
  if (!machine) notFound()

  const hoy = new Date().toISOString().slice(0, 10)
  const [documentos, vendors, diasTrabajados] = await Promise.all([
    hojaDeVida(company.id, machine.id, hoy),
    prisma.vendor.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.equipmentEntry.count({ where: { companyId: company.id, equipmentId: machine.id } }),
  ])

  const canManage = user.permissions.has('equipment:manage')
  const vigentes = documentos.filter((doc) => doc.active)
  const archivados = documentos.filter((doc) => !doc.active)
  const alertas = vigentes.filter(
    (doc) => doc.estado.estado === 'VENCIDO' || doc.estado.estado === 'POR_VENCER',
  )

  return (
    <>
      <PageHeader
        title={machine.name}
        subtitle={`${machine.code} · ${KIND[machine.kind] ?? machine.kind} · ${
          OWNERSHIP[machine.ownership] ?? machine.ownership
        }${machine.vendor ? ` · ${machine.vendor.name}` : ''}`}
        action={
          <LinkButton href="/equipment" variant="secondary">
            Volver
          </LinkButton>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Documentos al día"
          value={String(vigentes.length - alertas.length)}
          hint={`de ${vigentes.length}`}
        />
        <Stat
          label="Necesitan atención"
          value={String(alertas.length)}
          tone={alertas.length > 0 ? 'warning' : 'good'}
          hint={alertas.length > 0 ? 'vencidos o por vencer' : 'ninguno'}
        />
        <Stat
          label="Costo diario"
          value={machine.dailyCost ? `$${money(machine.dailyCost)}` : '—'}
          hint={machine.ownership === 'RENTED' ? 'se le paga al proveedor' : 'propio, no se paga'}
        />
        <Stat label="Días en obra" value={String(diasTrabajados)} hint="registrados en semanas" />
      </div>

      {/* Lo urgente primero: es la razón de que esta pantalla exista. */}
      {alertas.length > 0 ? (
        <section className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            {alertas.length === 1 ? 'Hay 1 documento que atender' : `Hay ${alertas.length} documentos que atender`}
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {alertas.map((doc) => (
              <li key={doc.id}>
                <strong>{doc.title}</strong> — {doc.estado.mensaje}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-8">
        <h2 className="brand-label mb-1 text-[var(--muted)]">Hoja de vida</h2>
        <p className="mb-3 text-sm text-[var(--muted)]">
          Seguros, títulos, matrículas y mantenimientos. Cada uno con su fecha de vencimiento: el
          sistema avisa antes, con la anticipación que tú le pongas.
        </p>

        {canManage ? <AddRecordForm equipmentId={machine.id} vendors={vendors} /> : null}

        {vigentes.length === 0 ? (
          <EmptyState
            title="Sin documentos todavía"
            hint="Agrega el seguro, el título o el último mantenimiento para empezar la hoja de vida."
          />
        ) : (
          <ul className="space-y-2">
            {vigentes.map((doc) => (
              <RecordCard
                key={doc.id}
                equipmentId={machine.id}
                record={doc as RecordRow}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
      </section>

      {archivados.length > 0 ? (
        <section className="mb-8">
          <h2 className="brand-label mb-1 text-[var(--muted)]">Histórico</h2>
          <p className="mb-3 text-sm text-[var(--muted)]">
            Documentos reemplazados. Ya no avisan, pero se conservan: la historia de pólizas de
            una máquina es parte de su hoja de vida.
          </p>
          <ul className="space-y-2">
            {archivados.map((doc) => (
              <RecordCard
                key={doc.id}
                equipmentId={machine.id}
                record={doc as RecordRow}
                canManage={canManage}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {machine.notes ? (
        <section className="mb-8">
          <h2 className="brand-label mb-2 text-[var(--muted)]">Notas</h2>
          <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm">
            {machine.notes}
          </p>
        </section>
      ) : null}

      <p className="text-sm text-[var(--muted)]">
        Los datos de alquiler (costo diario, proveedor) se editan en{' '}
        <Link prefetch={false} href="/equipment" className="underline">
          el catálogo de equipos
        </Link>
        .
      </p>
    </>
  )
}
