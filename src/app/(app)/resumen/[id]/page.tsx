import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

interface Renglon {
  nombre: string
  neto: string
}

function money(valor: string | number): string {
  return Number(valor).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * El resumen con el que se mandó una semana a aprobación.
 *
 * Todo lo que se ve aquí está CONGELADO: son los totales del momento en que se
 * envió, no una consulta de hoy. Es lo que hace que el papel sirva — si al
 * abrirlo mostrara las cifras actuales, no habría contra qué comparar cuando
 * alguien pregunta «¿esto es lo que aprobamos?».
 */
export default async function ResumenPage({ params }: { params: Promise<{ id: string }> }) {
  await assertCan('payroll:view')
  const company = await getActiveCompany()
  const { id } = await params

  const resumen = await prisma.approvalSummary.findFirst({
    where: { id, companyId: company.id },
    include: {
      payrollWeek: { select: { id: true, year: true, weekNumber: true, label: true } },
    },
  })
  if (!resumen) notFound()

  const renglones = resumen.linesJson as {
    personal?: Renglon[]
    equipos?: Renglon[]
    cuadrillas?: Renglon[]
  }

  const bloques = [
    { titulo: 'Personal', filas: renglones.personal ?? [], total: resumen.workersTotal },
    { titulo: 'Equipo rentado', filas: renglones.equipos ?? [], total: resumen.equipmentTotal },
    { titulo: 'Cuadrillas', filas: renglones.cuadrillas ?? [], total: resumen.crewsTotal },
  ]

  const semana =
    resumen.payrollWeek.label ?? `Semana ${resumen.payrollWeek.weekNumber}`

  return (
    <>
      <PageHeader
        title={resumen.number}
        subtitle={`Resumen para aprobación · ${semana} · ${resumen.payrollWeek.year} · ${company.displayName}`}
        back={{ href: `/payroll/${resumen.payrollWeek.id}`, label: 'La semana' }}
      />

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <p className="mb-4 text-sm text-[var(--muted)]">
          Preparado por <strong>{resumen.preparedByName}</strong> ·{' '}
          {resumen.createdAt.toISOString().slice(0, 10)}
        </p>

        {bloques.map((bloque) => (
          <section key={bloque.titulo} className="mb-5">
            <div className="flex items-baseline justify-between border-b border-[var(--border)] pb-1">
              <h2 className="text-sm font-semibold">{bloque.titulo}</h2>
              <span className="text-sm font-semibold tabular-nums">
                ${money(bloque.total.toString())}
              </span>
            </div>

            {bloque.filas.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--muted)]">Nada en este bloque.</p>
            ) : (
              <ul className="mt-1">
                {bloque.filas.map((fila, indice) => (
                  <li
                    key={`${fila.nombre}-${indice}`}
                    className="flex justify-between py-0.5 text-sm"
                  >
                    <span>{fila.nombre}</span>
                    <span className="tabular-nums">${money(fila.neto)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <div className="flex items-baseline justify-between border-t-2 border-[var(--ink)] pt-2">
          <span className="font-semibold">Total a aprobar</span>
          <span className="text-lg font-semibold tabular-nums">
            ${money(resumen.grandTotal.toString())}
          </span>
        </div>
      </div>

      <p className="mt-4 text-sm text-[var(--muted)]">
        Estas son las cifras del momento en que se envió. Si después cambió algo en la semana, este
        papel sigue diciendo lo de ese día — es contra lo que se compara.{' '}
        <Link prefetch={false} href="/resumen" className="text-[var(--accent)] underline">
          Ver todos los resúmenes
        </Link>
        .
      </p>
    </>
  )
}
