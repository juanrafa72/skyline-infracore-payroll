import Link from 'next/link'
import { EmptyState, PageHeader } from '@/components/ui'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

/**
 * Los resúmenes con los que se han mandado semanas a aprobación.
 *
 * Cada uno tiene su consecutivo y sirve para citarlo por número —«el RA-0007»—
 * cuando quien prepara y quien aprueba hablan de una semana. Una misma semana
 * puede tener varios: si se devuelve y se vuelve a mandar, sale uno nuevo, y
 * los dos quedan. El histórico de qué se mandó y cuándo es justamente el
 * punto.
 */
export default async function ResumenesPage() {
  await assertCan('payroll:view')
  const company = await getActiveCompany()

  const resumenes = await prisma.approvalSummary.findMany({
    where: { companyId: company.id },
    include: { payrollWeek: { select: { year: true, weekNumber: true, label: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <>
      <PageHeader
        title="Resúmenes para aprobación"
        subtitle={`${company.displayName} · lo que se mandó, con su consecutivo`}
      />

      {resumenes.length === 0 ? (
        <EmptyState
          title="Todavía no se ha mandado ninguna semana"
          hint="Al enviar una semana a aprobación se genera el resumen con su consecutivo."
        />
      ) : (
        <ul className="space-y-2">
          {resumenes.map((resumen) => (
            <li
              key={resumen.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  prefetch={false}
                  href={`/resumen/${resumen.id}`}
                  className="font-medium text-[var(--accent)] hover:underline"
                >
                  {resumen.number}
                </Link>
                <span className="text-lg font-semibold tabular-nums">
                  $
                  {Number(resumen.grandTotal).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>

              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {resumen.payrollWeek.label ?? `Semana ${resumen.payrollWeek.weekNumber}`} ·{' '}
                {resumen.payrollWeek.year} · {resumen.workersCount} persona(s) ·{' '}
                {resumen.equipmentCount} equipo(s) · {resumen.crewsCount} cuadrilla(s)
              </p>
              <p className="text-xs text-[var(--muted)]">
                Preparado por {resumen.preparedByName} ·{' '}
                {resumen.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
