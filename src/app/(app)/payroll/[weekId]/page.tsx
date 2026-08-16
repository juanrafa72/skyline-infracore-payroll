import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, Button, EmptyState, LinkButton, PageHeader, Stat, money } from '@/components/ui'
import { FlowSteps, NextStep, flowSteps } from '@/components/shell/FlowSteps'
import { requireUser } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { weekExtras } from '@/lib/payroll/extras/service'
import { ratesStatus } from '@/lib/payroll/rates-status/service'
import { shortDay, toIso } from '@/lib/payroll/week'
import { calculateWeek, copyPreviousWeek, resetWeek, saveWorkEntries } from '../actions'
import { puedeReiniciar } from '@/lib/payroll/reset'
import { ayudaDe, bloquea } from '@/lib/payroll/exceptions'
import { currentRoster } from '@/lib/payroll/roster'
import { Extras } from './Extras'
import { RunningTotal } from './RunningTotal'
import { RemoveWorker } from './RemoveWorker'
import { SubmitWeek } from './SubmitWeek'
import { AddWorkerInline, ChooseWorkers } from './ChooseWorkers'
import { CrewsBlock } from './CrewsBlock'
import { EquipmentBlock } from './EquipmentBlock'
import { weekCrewViews } from '@/lib/payroll/crews/service'
import { contractorWeekView, suggestBreakdown } from '@/lib/payroll/contractors/service'
import { weekEquipmentViews } from '@/lib/payroll/equipment/service'
import { ESTADO_NOMINA, TIPO_TARIFA, UNIDAD_MEDIDA, label } from '@/lib/payroll/labels'
import { ProjectDays } from './ProjectDays'

export const dynamic = 'force-dynamic'

/**
 * Columnas de la rejilla: nombre + N días + tarifa.
 *
 * El número de días depende de la frecuencia (1, 7, 14, 15, 16, 30, 31…), así
 * que la plantilla se pasa como variable CSS en línea. No puede ser una clase
 * de Tailwind armada con texto: Tailwind solo genera las clases que ve escritas
 * literalmente en el código.
 */
function gridTemplate(dayCount: number): string {
  // Trabajador · Proyecto · un día por columna · Quitar
  if (dayCount > 16) return 'minmax(170px,1fr) minmax(120px,0.8fr) minmax(0,6fr) minmax(64px,0.5fr)'
  return `minmax(170px,1.5fr) minmax(110px,0.9fr) repeat(${dayCount},minmax(0,1fr)) minmax(64px,0.6fr)`
}

/** Clase estática que consume la variable. Esta sí la compila Tailwind. */
const GRID_CLASS = 'md:[grid-template-columns:var(--payroll-grid)] md:gap-2'


export default async function WeekPage({
  params,
  searchParams,
}: {
  params: Promise<{ weekId: string }>
  searchParams: Promise<{
    todos?: string
    op?: string
    paso?: string
    msg?: string
    /** `dias` = se acaba de guardar la rejilla: el paso siguiente late. */
    guardado?: string
  }>
}) {
  const { weekId } = await params
  const filters = await searchParams
  const user = await requireUser()
  const company = await getActiveCompany()

  const week = await prisma.payrollWeek.findFirst({
    where: { id: weekId, companyId: company.id },
  })
  if (!week) notFound()

  // Quién ya fue agregado o sacado de este período a mano.
  const roster = await prisma.payrollWeekMember.findMany({
    where: { companyId: company.id, payrollWeekId: week.id },
    select: { workerId: true, removedAt: true },
  })
  const addedIds = roster.filter((row) => !row.removedAt).map((row) => row.workerId)
  const removedIds = new Set(roster.filter((row) => row.removedAt).map((row) => row.workerId))

  /*
   * En la rejilla solo sale quien fue elegido para este período, o quien ya
   * tiene días marcados. Nada de listas de 149 personas cuando trabajaron doce.
   */
  const workerFilter = {
    companyId: company.id,
    status: 'ACTIVE' as const,
    OR: [
      { id: { in: addedIds.length > 0 ? addedIds : ['-'] } },
      // Un día de control de cuadrilla no mete a nadie a la nómina de personal.
      { workEntries: { some: { payrollWeekId: week.id, isControlOnly: false } } },
    ],
  }

  const [chosenWorkers, entries, payrolls, exceptions, operations] = await Promise.all([
    prisma.worker.findMany({
      where: workerFilter,
      orderBy: { displayName: 'asc' },
    }),
    prisma.workEntry.findMany({
      // La rejilla de personal solo ve días que pagan; los de control viven
      // en el bloque de cuadrillas.
      where: { companyId: company.id, payrollWeekId: week.id, isControlOnly: false },
    }),
    prisma.workerPayroll.findMany({
      where: { companyId: company.id, payrollWeekId: week.id },
      include: { worker: true, lines: true },
      orderBy: { worker: { displayName: 'asc' } },
    }),
    prisma.exception.findMany({
      where: { companyId: company.id, payrollWeekId: week.id, status: 'OPEN' },
    }),
    prisma.operation.findMany({ where: { companyId: company.id }, orderBy: { sortOrder: 'asc' } }),
  ])

  const workers = chosenWorkers.filter((worker) => !removedIds.has(worker.id))

  const workersWithDays = new Set(entries.map((entry) => entry.workerId))

  // Paso 1 cuando no hay nadie elegido todavía, o cuando se pide agregar.
  /*
   * Producción de esta misma semana.
   *
   * Un corte puede tener días pagados por jornal Y producción pagada por pie
   * construido, incluso de la misma cuadrilla. Mostrarlos por separado obliga a
   * sumar de cabeza para saber cuánto se debe esa semana, así que van juntos.
   */
  const production = await prisma.production.findMany({
    where: { companyId: company.id, payrollWeekId: week.id },
    include: { crew: { select: { name: true } }, project: { select: { name: true } } },
    orderBy: [{ productionDate: 'asc' }],
  })

  /*
   * Bloque de cuadrillas: producción agrupada por crew + su liquidación
   * (deuda con el contratista) + los días de control de su gente.
   */
  const crewViews = await weekCrewViews(company.id, week.id)
  const productionByCrew = new Map<string, typeof production>()
  const looseProduction: typeof production = []
  for (const row of production) {
    if (row.crewId) {
      const list = productionByCrew.get(row.crewId) ?? []
      list.push(row)
      productionByCrew.set(row.crewId, list)
    } else {
      looseProduction.push(row)
    }
  }
  const productionRow = (row: (typeof production)[number]) => ({
    id: row.id,
    label: row.unitLabel,
    /*
     * La unidad se muestra en español (`unitLabel`, «pies»), no el código
     * (`unitOfMeasure`, «FOOT»): en pantalla se leía «10,000 foot».
     */
    quantity: `${Number(row.quantity).toLocaleString('en-US')} ${UNIDAD_MEDIDA[row.unitOfMeasure] ?? row.unitLabel}${
      row.project ? ` · ${row.project.name}` : ''
    }`,
    cost: row.amount.toFixed(2),
    revenue: row.revenue === null ? null : row.revenue.toFixed(2),
    margin: row.revenue === null ? null : (Number(row.revenue) - Number(row.amount)).toFixed(2),
  })
  const equipmentViews = await weekEquipmentViews(company.id, week.id)
  const equipmentRows = equipmentViews.map((view) => ({
    equipmentId: view.equipmentId,
    name: view.name,
    kindLabel: view.kindLabel,
    ownership: view.ownership,
    dailyCost: view.dailyCost,
    vendorName: view.vendorName,
    hasVendor: view.hasVendor,
    payable: view.payable
      ? {
          total: view.payable.total,
          days: view.payable.days,
          statusLabel: label(ESTADO_NOMINA, view.payable.status),
        }
      : null,
    markedDays: view.markedDays,
    /*
     * El proyecto de sus días. Se toma el del primer día marcado: la renta se
     * carga a una obra por semana. Si todavía no hay días, se propone el de la
     * ficha del equipo.
     */
    projectId:
      view.markedDays.map((key) => view.projectByDay[key]).find(Boolean) ??
      view.defaultProjectId,
  }))

  const crewsForBlock = crewViews.map((view) => ({
    crewId: view.crewId,
    crewName: view.crewName,
    contractorName: view.contractorName,
    hasContractor: view.hasContractor,
    billingMode: view.billingMode,
    dailyRate: view.dailyRate,
    crewDays: view.crewDays,
    projectId: view.projectId,
    payable: view.payable
      ? {
          total: view.payable.total,
          count: view.payable.count,
          statusLabel: label(ESTADO_NOMINA, view.payable.status),
        }
      : null,
    members: view.members,
    controlDays: view.controlDays,
    production: (productionByCrew.get(view.crewId) ?? []).map(productionRow),
  }))

  /*
   * Desglose y conciliación por contratista.
   *
   * Solo para las cuadrillas que ya tienen liquidación: sin ella no hay contra
   * qué conciliar. Cada panel trae además la gente sugerida de la cuadrilla,
   * para no teclear la lista completa la primera vez.
   */
  const contractorPanels = (
    await Promise.all(
      crewViews
        .filter((view) => view.payable !== null)
        .map(async (view) => {
          const detail = await contractorWeekView(company.id, view.payable!.id)
          if (!detail) return null
          const suggestion =
            detail.members.length === 0
              ? await suggestBreakdown(company.id, detail.crewPayrollId)
              : []
          return {
            crewPayrollId: detail.crewPayrollId,
            crewName: detail.crewName,
            contractorName: detail.contractorName,
            editable:
              user.permissions.has('payroll:edit') &&
              ['DRAFT', 'PREPARED', 'REJECTED'].includes(detail.status),
            members: detail.members,
            production: detail.production,
            expectedTotal: detail.expectedTotal,
            suggestion,
            // Si la propuesta ya trae tarifas, salió de la semana pasada.
            suggestionFromLastWeek: suggestion.some((s) => s.rateAmount !== undefined),
          }
        }),
    )
  ).filter((panel): panel is NonNullable<typeof panel> => panel !== null)

  const showChooser = workers.length === 0 || filters.paso === 'personas'

  /*
   * La lista completa de personas solo se consulta en el paso 1. Traerla
   * siempre significaba cargar 149 trabajadores con sus tarifas en cada
   * pantalla de días, para nada.
   */
  /*
   * "¿Quién tiene tarifa?" se responde con rates-status, la misma vara del
   * motor: vigencia al inicio de ESTA semana, con el proyecto y la operación
   * de cada persona. Antes se contaba cualquier tarifa activa sin mirar
   * fechas, y una persona con tarifa vencida entraba al paso 1 para reventar
   * en el cálculo. La rejilla y la suma en vivo usan el mismo dato.
   */
  const rateStatus = await ratesStatus(company.id, toIso(week.startDate))
  const rateOf = new Map(
    rateStatus.needsRate
      .filter((row) => row.resolvedAmount !== null)
      .map((row) => [row.workerId, { amount: row.resolvedAmount!, rateType: row.rateType }]),
  )

  /*
   * La semana anterior alimenta dos comodidades: el botón "copiar semana"
   * (quiénes) y la sugerencia de proyecto en la rejilla. Solo lectura — nada
   * de la semana pasada se escribe en esta.
   */
  const previousWeek = await prisma.payrollWeek.findFirst({
    where: { companyId: company.id, startDate: { lt: week.startDate }, isOffCycle: false },
    orderBy: { startDate: 'desc' },
  })
  const previousRosterCount =
    showChooser && previousWeek ? (await currentRoster(company.id, previousWeek.id)).length : 0

  const prevProjectOf = new Map<string, string>()
  if (!showChooser && previousWeek) {
    const previousEntries = await prisma.workEntry.findMany({
      where: {
        companyId: company.id,
        payrollWeekId: previousWeek.id,
        projectId: { not: null },
        isControlOnly: false,
        workerId: { in: workers.map((worker) => worker.id) },
      },
      select: { workerId: true, projectId: true },
    })
    for (const entry of previousEntries) {
      if (entry.projectId && !prevProjectOf.has(entry.workerId)) {
        prevProjectOf.set(entry.workerId, entry.projectId)
      }
    }
  }

  const [everyone, crews] = showChooser
    ? await Promise.all([
        prisma.worker.findMany({
          where: { companyId: company.id, status: 'ACTIVE' },
          orderBy: { displayName: 'asc' },
        }),
        prisma.crew.findMany({ where: { companyId: company.id }, select: { id: true, name: true } }),
      ])
    : [[], []]

  const crewName = new Map(crews.map((crew) => [crew.id, crew.name]))
  const withRate = everyone.filter((person) => rateOf.has(person.id))
  const hiddenWithoutRate = everyone.length - withRate.length

  // El período puede durar 1, 7, 14, 15, 16, 28, 30 o 31 días según la
  // frecuencia, o lo que dure un corte. Se recorre de inicio a fin.
  const days: string[] = []
  for (
    let cursor = new Date(week.startDate);
    toIso(cursor) <= toIso(week.endDate);
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    days.push(toIso(cursor))
  }

  /*
   * Los proyectos donde se puede trabajar, y en cuál está cada persona ya.
   *
   * El proyecto se lee de los días que ya tiene marcados; si no tiene ninguno,
   * se propone el suyo por defecto.
   */
  const projects = await prisma.project.findMany({
    where: { companyId: company.id, active: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  const projectOf = new Map<string, string>()
  for (const entry of entries) {
    if (entry.projectId && !projectOf.has(entry.workerId)) {
      projectOf.set(entry.workerId, entry.projectId)
    }
  }

  /*
   * Quién tiene la semana repartida entre varios proyectos.
   *
   * Pasa de verdad: lunes, martes y viernes en un pueblo, miércoles y jueves en
   * otro. Cuando ya está así, la fila ARRANCA en modo por día — con un solo
   * selector, el siguiente «Guardar días» mandaría toda la semana al mismo
   * proyecto sin que nadie lo pidiera, y ese es el dato con el que se factura.
   *
   * Un día a propósito sin proyecto cuenta como valor distinto: mezclar «sin
   * proyecto» con «Dublin» también es una semana repartida.
   */
  const projectsByWorker = new Map<string, Set<string>>()
  for (const entry of entries) {
    const seen = projectsByWorker.get(entry.workerId) ?? new Set<string>()
    seen.add(entry.projectId ?? '')
    projectsByWorker.set(entry.workerId, seen)
  }

  // Lo que no es un día trabajado pero cambia el pago: hotel, equipo, bonos.
  const extras = await weekExtras(company.id, week.id)

  const entryMap = new Map(
    entries.map((entry) => [
      `${entry.workerId}:${toIso(entry.workDate)}`,
      {
        dayType: entry.dayType as string,
        amount: entry.additionalAmount ? entry.additionalAmount.toFixed(2) : '',
        note: entry.additionalNote ?? '',
        // '' = el día existe y quedó sin proyecto, que no es lo mismo que no
        // tener día. La rejilla necesita distinguirlos.
        projectId: entry.projectId ?? '',
      },
    ]),
  )

  const totals = payrolls.reduce(
    (accumulator, payroll) => ({
      gross: accumulator.gross + Number(payroll.grossPay),
      deductions: accumulator.deductions + Number(payroll.deductionsTotal),
      net: accumulator.net + Number(payroll.netPay),
    }),
    { gross: 0, deductions: 0, net: 0 },
  )

  // Los que de verdad frenan un pago. Los que trajo el Excel no cuentan: se
  // ven en /avisos y no tienen nada que ver con esta semana.
  const critical = exceptions.filter(bloquea)

  // ¿Se puede devolver esta semana al principio? Se pregunta siempre para
  // poder explicar POR QUÉ no, en vez de esconder el botón sin más.
  const reinicio = await puedeReiniciar(company.id, week.id)

  // Viene de guardar la rejilla: el botón del paso siguiente late.
  const recienGuardado = filters.guardado === 'dias'

  /*
   * Los proyectos que ya aparecen en esta semana, para ponerlos arriba en los
   * selectores. Se juntan de los días de la gente, de los equipos y de la
   * producción: los tres apuntan a la misma obra.
   */
  const proyectosDeLaSemana = [
    ...new Set(
      [
        ...entries.map((entry) => entry.projectId),
        ...equipmentViews.map((view) => view.defaultProjectId),
        ...production.map((row) => row.projectId),
      ].filter((id): id is string => !!id),
    ),
  ]
  // Con más de 16 días las casillas van dentro de su propio bloque, no como
  // columnas de la rejilla: `md:contents` solo sirve cuando sí son columnas.
  const inlineDays = days.length <= 16
  const gridStyle = { '--payroll-grid': gridTemplate(days.length) } as React.CSSProperties

  return (
    <>
      <PageHeader
        title={`${week.label} · ${week.year}`}
        subtitle={`${toIso(week.startDate)} → ${toIso(week.endDate)} · ${company.displayName}`}
        action={<LinkButton href="/payroll" variant="secondary">Volver</LinkButton>}
      />

      {/* Dónde va uno en el camino de la semana, y cómo saltar al paso siguiente */}
      <FlowSteps
        current={payrolls.length === 0 ? 1 : 2}
        steps={flowSteps(user.permissions, week.id)}
        className="mb-5"
      />

      {week.isOffCycle ? (
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900">
          <strong>
            {week.settlementType === 'FINAL_SETTLEMENT'
              ? 'Liquidación por retiro'
              : 'Corte parcial'}
          </strong>{' '}
          — período fuera de calendario, de {toIso(week.startDate)} a {toIso(week.endDate)}.
          {week.offCycleReason ? ` ${week.offCycleReason}` : ''}
          <br />
          No forma parte del ciclo regular: los días que se marquen aquí no deben marcarse
          también en el período normal.
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Bruto" value={`$${money(totals.gross)}`} />
        <Stat label="Descuentos" value={`$${money(totals.deductions)}`} />
        <Stat label="Neto a pagar" value={`$${money(totals.net)}`} tone="good" />
        <Stat
          label="Avisos que frenan"
          value={String(critical.length)}
          tone={critical.length > 0 ? 'warning' : 'default'}
          hint={critical.length > 0 ? 'Ábrelos y ciérralos para poder aprobar' : 'Ninguno'}
        />
      </div>

      {/* Resultado de la última acción: reinicio, guardado, cálculo. */}
      {filters.msg ? (
        <p className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm">
          {filters.msg}
        </p>
      ) : null}

      {showChooser ? (
        <>
          {previousWeek && previousRosterCount > 0 ? (
            <form
              action={copyPreviousWeek}
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5"
            >
              <input type="hidden" name="weekId" value={week.id} />
              <div>
                <p className="text-sm font-semibold">¿La misma gente de la semana pasada?</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  Trae a las {previousRosterCount} persona(s) de {previousWeek.label} ·{' '}
                  {previousWeek.year}. Solo copia quiénes — los días los marcas tú, y el proyecto
                  queda sugerido. No saca a nadie que ya esté.
                </p>
              </div>
              <Button variant="secondary">Copiar semana anterior</Button>
            </form>
          ) : null}

          {withRate.length === 0 ? (
            <EmptyState
              title="Nadie tiene tarifa todavía"
              hint="Para armar una nómina hace falta al menos una persona con su tarifa."
              action={<LinkButton href="/workers/new">Crear la primera persona</LinkButton>}
            />
          ) : (
            <ChooseWorkers
              weekId={week.id}
              hiddenWithoutRate={hiddenWithoutRate}
              operations={operations.map((row) => ({ id: row.id, name: row.name }))}
              people={withRate.map((person) => ({
                id: person.id,
                name: person.displayName,
                rate: money(rateOf.get(person.id)!.amount),
                rateType: label(TIPO_TARIFA, rateOf.get(person.id)!.rateType).toLowerCase(),
                crew:
                  person.defaultCrewId && crewName.get(person.defaultCrewId)
                    ? crewName.get(person.defaultCrewId)!
                    : null,
                operation: person.defaultOperationId,
                chosen: workers.some((worker) => worker.id === person.id),
                hasDays: workersWithDays.has(person.id),
              }))}
            />
          )}
          <AddWorkerInline weekId={week.id} operations={operations} />
        </>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide">Días trabajados</h2>
            <p className="mb-3 text-xs text-[var(--muted)]">
              Sí = día completo · ½ = medio día · No = no trabajó · — = sin registrar todavía ·{' '}
              <strong>Sí +</strong> = trabajó y además se le paga algo extra ese día (pide monto y
              motivo; sin motivo no se guarda).
            </p>
            <p className="mb-3 text-xs text-[var(--muted)]">
              El proyecto va para toda la semana. Si alguien se movió —lunes, martes y viernes en
              uno, miércoles y jueves en otro— oprime{' '}
              <strong>«cambió de proyecto entre semana»</strong> en su fila y marca el proyecto de
              cada día.
            </p>

            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--hover)] px-3 py-2">
              <span className="text-sm">
                <strong>{workers.length}</strong> persona{workers.length === 1 ? '' : 's'} en esta
                semana
              </span>
              <Link
                prefetch={false}
                href={`/payroll/${week.id}?paso=personas`}
                className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                + Agregar personas
              </Link>
            </div>

            <form action={saveWorkEntries}>
              <input type="hidden" name="weekId" value={week.id} />

              {/*
                UN SOLO juego de campos, con el layout cambiando por CSS.
                Duplicar la rejilla (una versión de escritorio y otra de móvil)
                enviaría cada día dos veces y el segundo valor pisaría al primero.
              */}
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <div
                  style={gridStyle}
                  className={`hidden ${inlineDays ? 'md:grid' : ''} ${GRID_CLASS} border-b border-[var(--border)] bg-[var(--hover)] px-3 py-2.5`}
                >
                  <span className="brand-label text-[var(--muted)]">
                    Trabajador
                  </span>
                  <span className="brand-label text-[var(--muted)]">Proyecto</span>
                  {days.map((day) => (
                    <span
                      key={day}
                      className="text-center text-xs font-semibold uppercase tracking-wide text-[var(--muted)]"
                    >
                      {shortDay(day)}
                    </span>
                  ))}
                  <span className="text-right text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Quitar
                  </span>
                </div>

                {workers.map((worker) => {
                  const gridDays = days.map((day) => {
                    const current = entryMap.get(`${worker.id}:${day}`)
                    return {
                      iso: day,
                      label: shortDay(day),
                      dayType: current?.dayType ?? '',
                      amount: current?.amount ?? '',
                      note: current?.note ?? '',
                      // null = no hay día guardado; '' = día sin proyecto.
                      savedProjectId: current ? current.projectId : null,
                    }
                  })
                  const weekProject =
                    projectOf.get(worker.id) ??
                    prevProjectOf.get(worker.id) ??
                    worker.defaultProjectId ??
                    ''

                  return (
                  <div
                    key={worker.id}
                    style={gridStyle}
                    className={`border-b border-[var(--border)] px-3 py-3 last:border-b-0 md:grid ${GRID_CLASS} md:items-center md:py-2`}
                  >
                    <div className="min-w-0">
                      <Link
                        prefetch={false}
                        href={`/workers/${worker.id}`}
                        className="block truncate text-sm font-medium text-[var(--accent)] hover:underline"
                      >
                        {worker.displayName}
                      </Link>
                      {/* La tarifa, justo debajo del nombre: es donde se cometen los errores */}
                      {rateOf.has(worker.id) ? (
                        <span className="block text-xs tabular-nums text-[var(--muted)]">
                          ${money(rateOf.get(worker.id)!.amount)}{' '}
                          {label(TIPO_TARIFA, rateOf.get(worker.id)!.rateType).toLowerCase()}
                        </span>
                      ) : (
                        <span className="block text-xs font-medium text-red-600">
                          sin tarifa que aplique — no se podrá calcular
                        </span>
                      )}
                    </div>

                    {/*
                      En qué proyecto trabajó, y sus días.

                      No es un adorno: de aquí sale el cliente, y sin cliente no
                      se sabe a quién facturarle el día. Sin esto la venta y el
                      margen quedaban incompletos.

                      Van en el mismo componente porque comparten el
                      interruptor «uno para toda la semana» / «uno por día».
                      La clave lleva lo guardado: al volver de guardar o
                      calcular, los campos se vuelven a montar mostrando lo que
                      quedó, no lo que había antes.
                    */}
                    <ProjectDays
                      key={gridDays
                        .map((day) => `${day.dayType}/${day.amount}/${day.savedProjectId ?? ''}`)
                        .join('|')}
                      workerId={worker.id}
                      weekProjectId={weekProject}
                      days={gridDays}
                      projects={projects}
                      usados={proyectosDeLaSemana}
                      inlineDays={inlineDays}
                      startPerDay={(projectsByWorker.get(worker.id)?.size ?? 0) > 1}
                    />

                    <div className="mt-2 md:mt-0">
                      <RemoveWorker
                        weekId={week.id}
                        workerId={worker.id}
                        name={worker.displayName}
                        markedDays={
                          entries.filter((entry) => entry.workerId === worker.id).length
                        }
                      />
                    </div>
                  </div>
                  )
                })}
              </div>

              {/* Suma en vivo: días y gran total, mientras se marca */}
              <RunningTotal
                workers={workers.map((worker) => ({
                  id: worker.id,
                  name: worker.displayName,
                  rate: rateOf.get(worker.id)?.amount ?? null,
                }))}
              />

              <div className="mt-4 flex flex-wrap gap-2">
                <Button>Guardar días</Button>
              </div>
            </form>

            <Extras
              weekId={week.id}
              workers={workers.map((worker) => ({
                id: worker.id,
                name: worker.displayName,
              }))}
              rows={extras.rows}
              additionsTotal={extras.additionsTotal}
              deductionsTotal={extras.deductionsTotal}
              days={days}
            />

            <AddWorkerInline weekId={week.id} operations={operations} />
          </section>

          {/* Bloque 2: equipos. Bloque 3: cuadrillas. El orden es el
              que pidió el negocio: personal / equipo / crews. */}
          {equipmentRows.length > 0 ? (
            <EquipmentBlock
              weekId={week.id}
              shortDays={days.map((iso) => ({ iso, label: shortDay(iso) }))}
              rows={equipmentRows}
              projects={projects.map((project) => ({ id: project.id, name: project.name }))}
              projectsInUse={proyectosDeLaSemana}
            />
          ) : null}

          {crewsForBlock.length > 0 || looseProduction.length > 0 ? (
            <CrewsBlock
              weekId={week.id}
              shortDays={days.map((iso) => ({ iso, label: shortDay(iso) }))}
              crews={crewsForBlock}
              projects={projects.map((project) => ({ id: project.id, name: project.name }))}
              panels={contractorPanels}
              loose={looseProduction.map(productionRow)}
            />
          ) : null}

          {/*
            Paso siguiente. Al venir de guardar los días, el botón LATE: el
            negocio pidió que la aplicación señale sola dónde seguir en vez de
            que uno tenga que buscarlo. El ancla `#calcular` además lo trae a
            la vista, que en una semana con 40 personas queda lejos.
          */}
          <section className="mb-8" id="calcular">
            {recienGuardado ? (
              <p className="mb-2 text-sm text-[var(--muted)]">
                Días guardados. Ahora saca las cuentas:
              </p>
            ) : null}
            <form action={calculateWeek} className="mt-2">
              <input type="hidden" name="weekId" value={week.id} />
              <Button variant="secondary" highlight={recienGuardado}>
                Calcular nómina
              </Button>
            </form>
          </section>

          {/*
            Avisos de ESTA semana, con salida.
            Antes se listaban en rojo sin decir qué hacer ni ofrecer dónde
            cerrarlos: quien corregía el problema quedaba igual de bloqueado.
          */}
          {exceptions.length > 0 ? (
            <section className="mb-8">
              <h2 className="brand-label mb-3 text-[var(--muted)]">Avisos de esta semana</h2>
              <ul className="space-y-2">
                {exceptions.map((exception) => {
                  const frena = bloquea(exception)
                  const ayuda = ayudaDe(exception.code)
                  return (
                    <li
                      key={exception.id}
                      className={`rounded-lg border p-3 text-sm ${
                        frena
                          ? 'border-red-300 bg-red-50'
                          : 'border-[var(--border)] bg-[var(--surface)]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={frena ? 'critical' : 'info'}>
                          {frena ? 'Frena el pago' : 'Revisar'}
                        </Badge>
                        <span className="font-medium">{exception.title}</span>
                      </div>
                      <p className="mt-1">{ayuda.queEs}</p>
                      <p className="mt-1 text-[var(--muted)]">{ayuda.queHacer}</p>
                      <Link
                        href="/avisos"
                        prefetch={false}
                        className="mt-2 inline-block font-medium underline"
                      >
                        Ir a cerrarlo →
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

          {/*
            Empezar de cero.
            Es lo que permite ENSAYAR: sin esto, un cálculo mal hecho deja la
            semana a medias para siempre. Va al final, en gris y con motivo
            obligatorio, para que no se oprima por error.
          */}
          {payrolls.length > 0 && user.permissions.has('payroll:edit') ? (
            <section className="mb-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="brand-label mb-1 text-[var(--muted)]">Empezar esta semana de cero</h2>
              {reinicio.ok ? (
                <>
                  <p className="mb-3 text-sm text-[var(--muted)]">
                    Borra los cálculos y deja la semana como antes de calcular.{' '}
                    <strong>No se pierden</strong> los días marcados, la producción capturada ni
                    los descuentos que anotaste a mano: solo hay que volver a oprimir «Calcular».
                  </p>
                  <form action={resetWeek} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="weekId" value={week.id} />
                    <label className="min-w-56 flex-1 text-sm">
                      <span className="mb-1 block text-[var(--muted)]">Por qué (queda registrado)</span>
                      <input
                        name="motivo"
                        required
                        minLength={3}
                        placeholder="Ej.: estoy practicando con la semana"
                        className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
                      />
                    </label>
                    <Button variant="danger">Empezar de cero</Button>
                  </form>
                </>
              ) : (
                <p className="text-sm text-[var(--muted)]">{reinicio.motivo}</p>
              )}
            </section>
          ) : null}

          <section>
            <h2 className="brand-label mb-3 text-[var(--muted)]">Resultado</h2>
            {payrolls.length === 0 ? (
              <EmptyState
                title="Sin calcular"
                hint="Marca los días y presiona «Calcular nómina»."
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-[var(--hover)]">
                    <tr>
                      {['Trabajador', 'Días', '½', 'Bruto', 'Descuentos', 'Neto', 'Estado'].map(
                        (header, index) => (
                          <th
                            key={header}
                            className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] ${
                              index > 0 && index < 6 ? 'text-right' : 'text-left'
                            }`}
                          >
                            {header}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {payrolls.map((payroll) => (
                      <tr key={payroll.id} className="border-t border-[var(--border)]">
                        <td className="px-3 py-2.5 font-medium">{payroll.worker.displayName}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{payroll.daysFull}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{payroll.daysHalf}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">${money(payroll.grossPay)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">${money(payroll.deductionsTotal)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">${money(payroll.netPay)}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone="info">{label(ESTADO_NOMINA, payroll.status)}</Badge>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-[var(--border)] bg-[var(--hover)] font-semibold">
                      <td className="px-3 py-2.5">Total</td>
                      <td />
                      <td />
                      <td className="px-3 py-2.5 text-right tabular-nums">${money(totals.gross)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">${money(totals.deductions)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">${money(totals.net)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div id="enviar">
          <SubmitWeek
            highlight={filters.guardado === 'calculo'}
            payrolls={payrolls
              .filter((payroll) => ['PREPARED', 'REJECTED'].includes(payroll.status))
              .map((payroll) => ({
                id: payroll.id,
                name: payroll.worker.displayName,
                net: payroll.netPay.toFixed(2),
              }))}
            crews={crewViews
              .filter(
                (view) =>
                  view.payable && ['PREPARED', 'REJECTED'].includes(view.payable.status),
              )
              .map((view) => ({
                id: view.payable!.id,
                name: view.crewName,
                net: view.payable!.total,
              }))}
            equipment={equipmentViews
              .filter(
                (view) =>
                  view.payable && ['PREPARED', 'REJECTED'].includes(view.payable.status),
              )
              .map((view) => ({
                id: view.payable!.id,
                name: view.name,
                net: view.payable!.total,
              }))}
            blockedByErrors={critical.length}
            alreadySent={
              payrolls.filter((payroll) => payroll.status === 'PENDING_APPROVAL').length +
              crewViews.filter((view) => view.payable?.status === 'PENDING_APPROVAL').length +
              equipmentViews.filter((view) => view.payable?.status === 'PENDING_APPROVAL').length
            }
          />
          </div>

          {/* Lo que sigue cuando esta pantalla ya hizo lo suyo */}
          <NextStep
            title="Después de enviar"
            detail={
              user.permissions.has('payroll:approve')
                ? 'Lo enviado espera en Aprobar: ahí se revisa, se le asigna empresa receptora y se aprueba.'
                : 'Lo enviado espera a quien aprueba. Cuando lo apruebe, tesorería lo paga.'
            }
            href={user.permissions.has('payroll:approve') ? '/approvals' : null}
            button="Ir a aprobar"
          />
        </>
      )}
    </>
  )
}

