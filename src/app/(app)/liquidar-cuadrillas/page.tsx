import Link from 'next/link'
import { EmptyState, PageHeader } from '@/components/ui'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { contractorWeekView, suggestBreakdown } from '@/lib/payroll/contractors/service'
import { cuadrillasParaLaSemana, weekCrewViews } from '@/lib/payroll/crews/service'
import { ESTADO_NOMINA, UNIDAD_MEDIDA, label } from '@/lib/payroll/labels'
import { CrewsBlock } from '../payroll/[weekId]/CrewsBlock'
import { Escoger } from './Escoger'

export const dynamic = 'force-dynamic'

/**
 * Liquidar una cuadrilla, en SU semana.
 *
 * Las cuadrillas no van al ritmo de la gente. La nómina puede ir en la semana
 * 33 mientras Hugo se liquida por la 25 y Jesús por la 30, porque lo que manda
 * es cuándo llega la medición de lo construido — y son varias a la vez.
 *
 * Antes, para liquidar la semana 25 de Hugo había que abrir la página de la
 * semana 25 completa, con su gente y sus equipos, que no tenían nada que ver.
 * Aquí se escoge cuadrilla y semana, y se trabaja solo eso. La página de
 * Nómina sigue mostrando únicamente las cuadrillas de SU semana, para que
 * nadie crea que está viendo todo lo de una semana cuando no es así.
 */
export default async function LiquidarCuadrillasPage({
  searchParams,
}: {
  searchParams: Promise<{ crew?: string; semana?: string }>
}) {
  const user = await assertCan('payroll:view')
  const company = await getActiveCompany()
  const filtros = await searchParams

  /*
   * Las semanas que se ofrecen: las que tienen trabajo de cuadrilla, más las
   * abiertas. Las 149 del archivo del Excel no: nunca se van a liquidar aquí
   * (BR-153) y llenarían el selector de ruido.
   */
  const [cuadrillas, semanas] = await Promise.all([
    prisma.crew.findMany({
      where: { companyId: company.id, active: true },
      include: { contractor: { select: { name: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.payrollWeek.findMany({
      where: {
        companyId: company.id,
        OR: [
          { status: 'OPEN' },
          { production: { some: { crewId: { not: null } } } },
          { crewPayrolls: { some: {} } },
          { crewMembers: { some: {} } },
        ],
      },
      orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
      take: 60,
      select: { id: true, year: true, weekNumber: true, label: true, startDate: true, endDate: true },
    }),
  ])

  if (cuadrillas.length === 0) {
    return (
      <>
        <PageHeader title="Liquidar cuadrillas" subtitle={company.displayName} />
        <EmptyState
          title="Todavía no hay cuadrillas"
          hint="Se crean en Catálogos → Cuadrillas, con el contratista al que se le paga."
        />
      </>
    )
  }

  /*
   * Con cuál abre.
   *
   * La que tenga algo que liquidar, no la primera del abecedario: abrir en
   * «ADMIN — sin contratista» y con la pantalla vacía hace creer que no hay
   * nada que hacer. Si ninguna tiene trabajo, al menos una con contratista,
   * que es a quien se le paga.
   */
  const conTrabajo = await prisma.crewPayroll.findFirst({
    where: { companyId: company.id, status: { in: ['DRAFT', 'PREPARED', 'REJECTED'] } },
    orderBy: { updatedAt: 'desc' },
    select: { crewId: true },
  })
  const conProduccion = conTrabajo
    ? null
    : await prisma.production.findFirst({
        where: { companyId: company.id, crewId: { not: null } },
        orderBy: { productionDate: 'desc' },
        select: { crewId: true },
      })

  const sugerida =
    conTrabajo?.crewId ??
    conProduccion?.crewId ??
    cuadrillas.find((c) => c.contractorId !== null)?.id ??
    cuadrillas[0]!.id

  const crewId =
    filtros.crew && cuadrillas.some((c) => c.id === filtros.crew) ? filtros.crew : sugerida

  /*
   * La semana que se propone: la última donde ESA cuadrilla tiene algo. Sin
   * esto, uno escoge a Hugo y le sale la semana de la gente, que es justo la
   * confusión que esta pantalla existe para evitar.
   */
  const suya = await prisma.payrollWeek.findFirst({
    where: {
      companyId: company.id,
      OR: [
        { production: { some: { crewId } } },
        { crewPayrolls: { some: { crewId } } },
        { crewMembers: { some: { crewId } } },
      ],
    },
    orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
    select: { id: true },
  })

  const weekId =
    filtros.semana && semanas.some((s) => s.id === filtros.semana)
      ? filtros.semana
      : (suya?.id ?? semanas[0]?.id ?? null)

  const semana = semanas.find((s) => s.id === weekId) ?? null
  const cuadrilla = cuadrillas.find((c) => c.id === crewId)!

  const escoger = (
    <Escoger
      cuadrillas={cuadrillas.map((c) => ({
        id: c.id,
        name: c.name,
        contractorName: c.contractor?.name ?? null,
      }))}
      semanas={semanas.map((s) => ({
        id: s.id,
        label: `${s.label ?? `Semana ${s.weekNumber}`} · ${s.year}`,
      }))}
      crewId={crewId}
      weekId={weekId}
    />
  )

  if (!semana) {
    return (
      <>
        <PageHeader title="Liquidar cuadrillas" subtitle={company.displayName} />
        {escoger}
        <EmptyState
          title="No hay ninguna semana abierta"
          hint="Se abre desde Nómina, con «Abrir período»."
        />
      </>
    )
  }

  const vistas = await weekCrewViews(company.id, semana.id)
  const vista = vistas.find((v) => v.crewId === crewId) ?? null

  const disponibles = (await cuadrillasParaLaSemana(company.id, semana.id)).filter(
    (c) => c.id === crewId,
  )

  const panel = vista?.payable
    ? await (async () => {
        const detalle = await contractorWeekView(company.id, vista.payable!.id)
        if (!detalle) return null
        const sugerencia =
          detalle.members.length === 0
            ? await suggestBreakdown(company.id, detalle.crewPayrollId)
            : []
        return {
          crewPayrollId: detalle.crewPayrollId,
          crewName: detalle.crewName,
          contractorName: detalle.contractorName,
          editable:
            user.permissions.has('payroll:edit') &&
            ['DRAFT', 'PREPARED', 'REJECTED'].includes(detalle.status),
          members: detalle.members,
          production: detalle.production,
          expectedTotal: detalle.expectedTotal,
          suggestion: sugerencia,
          suggestionFromLastWeek: sugerencia.some((s) => s.rateAmount !== undefined),
        }
      })()
    : null

  const produccion = await prisma.production.findMany({
    where: { companyId: company.id, payrollWeekId: semana.id, crewId },
    include: { project: { select: { name: true } } },
    orderBy: { productionDate: 'asc' },
  })

  return (
    <>
      <PageHeader
        title="Liquidar cuadrillas"
        subtitle={`${company.displayName} · cada cuadrilla va por su propia semana`}
      />

      {escoger}

      {vista ? (
        <CrewsBlock
          weekId={semana.id}
          shortDays={diasDe(semana.startDate, semana.endDate)}
          crews={[
            {
              crewId: vista.crewId,
              crewName: vista.crewName,
              contractorName: vista.contractorName,
              hasContractor: vista.hasContractor,
              billingMode: vista.billingMode,
              dailyRate: vista.dailyRate,
              crewDays: vista.crewDays,
              projectId: vista.projectId,
              payable: vista.payable
                ? {
                    total: vista.payable.total,
                    count: vista.payable.count,
                    statusLabel: label(ESTADO_NOMINA, vista.payable.status),
                  }
                : null,
              members: vista.members,
              controlDays: vista.controlDays,
              production: produccion.map((row) => ({
                id: row.id,
                label: row.unitLabel,
                // La unidad en español («pies»), no el código («FOOT»).
                quantity: `${Number(row.quantity).toLocaleString('en-US')} ${
                  UNIDAD_MEDIDA[row.unitOfMeasure] ?? row.unitLabel
                }${row.project ? ` · ${row.project.name}` : ''}`,
                cost: row.amount.toFixed(2),
                revenue: row.revenue === null ? null : row.revenue.toFixed(2),
                margin:
                  row.revenue === null
                    ? null
                    : (Number(row.revenue) - Number(row.amount)).toFixed(2),
              })),
            },
          ]}
          loose={[]}
          panels={panel ? [panel] : []}
          disponibles={disponibles}
        />
      ) : (
        <EmptyState
          title={`${cuadrilla.name} no está en esa semana`}
          hint="Escoge otra semana, o agrégala desde la página de esa semana en Nómina."
        />
      )}

      <p className="mt-4 text-sm text-[var(--muted)]">
        La producción se captura en{' '}
        <Link prefetch={false} href="/production" className="text-[var(--accent)] underline">
          Producción
        </Link>
        . Lo que se apruebe y se pague de esta cuadrilla sale por el mismo camino de siempre:{' '}
        <Link prefetch={false} href="/approvals" className="text-[var(--accent)] underline">
          Aprobar
        </Link>{' '}
        y{' '}
        <Link prefetch={false} href="/disbursements" className="text-[var(--accent)] underline">
          Pagar
        </Link>
        .
      </p>
    </>
  )
}

/** Los días de la semana, para la rejilla de días de control. */
function diasDe(inicio: Date, fin: Date): Array<{ iso: string; label: string }> {
  const NOMBRES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
  const dias: Array<{ iso: string; label: string }> = []
  for (
    let cursor = new Date(inicio);
    cursor.toISOString().slice(0, 10) <= fin.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const iso = cursor.toISOString().slice(0, 10)
    dias.push({ iso, label: `${NOMBRES[cursor.getUTCDay()]} ${cursor.getUTCDate()}` })
  }
  return dias
}
