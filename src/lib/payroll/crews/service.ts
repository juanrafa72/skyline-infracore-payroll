import { prisma } from '@/lib/db/client'
import type { CurrentUser } from '@/lib/auth/rbac'
import { crewDailyTotal, sumProductionAmounts } from '@/lib/payroll/engine/payables'
import { ZERO, toCents, toDecimalString } from '@/lib/payroll/engine/money'
import { invalidateCrewIfStale } from '@/lib/payroll/workflow/payables'
import { toIso } from '@/lib/payroll/week'
import { estaEnLaSemana, puedeSacarse } from '../week-roster'

/**
 * Liquidaciones de cuadrilla: de la producción registrada a la deuda con el
 * contratista, y los días de control de su gente.
 *
 * La producción ya trae los precios congelados (BR-213); aquí solo se SUMA en
 * centavos y se congela a quién se le paga. Los días de la gente del crew son
 * control interno: no generan pago individual — al contratista se le paga por
 * producción y él le paga a su gente.
 */

const EDITABLE = ['DRAFT', 'PREPARED', 'REJECTED'] as const

export interface SyncResult {
  ok: boolean
  message: string
  synced: number
  /** Cuadrillas cuya liquidación no se tocó por su estado, con el porqué. */
  untouched: Array<{ crewName: string; reason: string }>
}

/**
 * Alinea las liquidaciones de cuadrilla de una semana con su producción.
 *
 * Crea o recalcula solo las editables; una liquidación enviada, aprobada o
 * pagada NO se recalcula en silencio — para eso está la invalidación, que deja
 * rastro. Si una cuadrilla se quedó sin producción, su liquidación editable se
 * elimina (la no editable se reporta).
 */
export async function syncCrewPayrolls(
  companyId: string,
  payrollWeekId: string,
): Promise<SyncResult> {
  const [production, dayEntries] = await Promise.all([
    prisma.production.findMany({
      where: { companyId, payrollWeekId, crewId: { not: null } },
      orderBy: { productionDate: 'asc' },
    }),
    // Días de las cuadrillas que cobran un precio fijo por día.
    prisma.crewDayEntry.findMany({ where: { companyId, payrollWeekId } }),
  ])

  const byCrew = new Map<string, typeof production>()
  for (const row of production) {
    const list = byCrew.get(row.crewId!) ?? []
    list.push(row)
    byCrew.set(row.crewId!, list)
  }

  const daysByCrew = new Map<string, number>()
  for (const entry of dayEntries) {
    daysByCrew.set(entry.crewId, (daysByCrew.get(entry.crewId) ?? 0) + 1)
  }

  // Se liquidan las cuadrillas con producción Y las que tienen días marcados:
  // las de cobro diario no registran producción.
  const crewIds = [...new Set([...byCrew.keys(), ...daysByCrew.keys()])]

  const crews = await prisma.crew.findMany({
    where: { id: { in: crewIds } },
    include: { contractor: { select: { id: true, name: true } } },
  })
  const crewById = new Map(crews.map((crew) => [crew.id, crew]))

  const existing = await prisma.crewPayroll.findMany({
    where: { companyId, payrollWeekId },
  })
  const existingByCrew = new Map(existing.map((row) => [row.crewId, row]))

  let synced = 0
  const untouched: SyncResult['untouched'] = []

  for (const crewId of crewIds) {
    const crew = crewById.get(crewId)
    if (!crew) continue

    const current = existingByCrew.get(crewId)
    if (current && !EDITABLE.includes(current.status as (typeof EDITABLE)[number])) {
      untouched.push({
        crewName: crew.name,
        reason: `su liquidación está ${current.status === 'PENDING_APPROVAL' ? 'esperando aprobación' : 'aprobada o pagada'} y no se recalcula en silencio`,
      })
      continue
    }

    /*
     * De dónde sale el total, según cómo cobre la cuadrilla.
     *
     * PRODUCCIÓN: la suma de lo construido, con los precios ya congelados al
     * registrarla (BR-213). DIARIO: días marcados × tarifa diaria, igual que
     * un equipo rentado — pero el beneficiario es el CONTRATISTA.
     *
     * Sin tarifa diaria NO se inventa un cero: la liquidación queda en cero y
     * el aviso crítico frena la aprobación, como con el equipo sin costo
     * (BR-245). Pagar $0.00 en silencio es la enfermedad de los Excel.
     */
    const esDiario = crew.billingMode === 'DAILY'
    const dias = daysByCrew.get(crewId) ?? 0
    const filas = byCrew.get(crewId) ?? []

    const tarifaDiaria = crew.dailyRate ? toCents(crew.dailyRate.toFixed(2)) : null
    const total = esDiario
      ? tarifaDiaria === null
        ? ZERO
        : crewDailyTotal(dias, tarifaDiaria)
      : sumProductionAmounts(filas.map((row) => row.amount.toFixed(2)))

    const comun = {
      status: 'PREPARED' as const,
      productionTotal: toDecimalString(total),
      // En modo diario el «conteo» son los días: es lo que sustenta el total.
      productionCount: esDiario ? dias : filas.length,
      billingModeSnapshot: crew.billingMode,
      appliedDailyRate: esDiario ? (crew.dailyRate ?? null) : null,
      contractorId: crew.contractorId,
      crewNameSnapshot: crew.name,
      contractorNameSnapshot: crew.contractor?.name ?? null,
      preparedAt: new Date(),
    }

    const payroll = await prisma.crewPayroll.upsert({
      where: {
        companyId_payrollWeekId_crewId: { companyId, payrollWeekId, crewId },
      },
      update: comun,
      create: { companyId, payrollWeekId, crewId, ...comun },
    })

    // Sin tarifa diaria no hay cifra que pagar: error CRÍTICO que bloquea la
    // aprobación, igual que un equipo rentado sin costo.
    await prisma.exception.deleteMany({
      where: { companyId, entityType: 'CrewPayroll', entityId: payroll.id, status: 'OPEN' },
    })
    if (esDiario && tarifaDiaria === null) {
      await prisma.exception.create({
        data: {
          companyId,
          code: 'MISSING_RATE',
          level: 'CRITICAL',
          entityType: 'CrewPayroll',
          entityId: payroll.id,
          payrollWeekId,
          title: `${crew.name} no tiene tarifa diaria`,
          detail:
            'La cuadrilla cobra por día pero no se ha definido cuánto. Ponle la tarifa en ' +
            'Catálogos → Cuadrillas: sin ella no se puede calcular lo que se le debe.',
        },
      })
    }

    synced += 1
  }

  // Cuadrillas que se quedaron sin producción ni días esta semana.
  for (const row of existing) {
    if (crewIds.includes(row.crewId)) continue
    if (!EDITABLE.includes(row.status as (typeof EDITABLE)[number])) {
      untouched.push({
        crewName: row.crewNameSnapshot,
        reason: 'se quedó sin producción pero su liquidación ya no es editable; hay que devolverla',
      })
      continue
    }
    await prisma.crewPayroll.delete({ where: { id: row.id } })
  }

  return {
    ok: true,
    message:
      synced === 0
        ? 'Ninguna cuadrilla tiene producción esta semana.'
        : `${synced} liquidación(es) de cuadrilla al día.`,
    synced,
    untouched,
  }
}

/**
 * Tras registrar o borrar producción: realinear las editables e invalidar las
 * aprobadas cuya huella ya no coincida. La aprobación se cae con rastro, jamás
 * se corrige en silencio.
 */
export async function reconcileCrewWeek(companyId: string, payrollWeekId: string): Promise<void> {
  await syncCrewPayrolls(companyId, payrollWeekId)

  const approved = await prisma.crewPayroll.findMany({
    where: { companyId, payrollWeekId, status: { in: ['APPROVED', 'READY_TO_PAY'] } },
    select: { id: true },
  })
  for (const payroll of approved) {
    await invalidateCrewIfStale(payroll.id)
  }
}

// ─────────────────────────────────────────────────────────────
// Días de control de la gente del crew
// ─────────────────────────────────────────────────────────────

export interface ControlDaysInput {
  /** Universo de filas que la pantalla mostró: persona → cuadrilla. */
  workers: ReadonlyArray<{ workerId: string; crewId: string }>
  /** Las casillas que quedaron marcadas. */
  marked: ReadonlyArray<{ workerId: string; date: string }>
}

export interface ControlDaysResult {
  ok: boolean
  message: string
}

/**
 * Guarda los días de control: la fila marcada existe, la desmarcada no.
 *
 * Un día de control JAMÁS pisa un día pagado: si la persona ya tiene un día
 * normal esa fecha (está también en la nómina de personal), esa casilla se
 * salta y se reporta. La restricción única de la base es el respaldo.
 */
export async function saveControlDays(
  user: CurrentUser,
  payrollWeekId: string,
  input: ControlDaysInput,
): Promise<ControlDaysResult> {
  const week = await prisma.payrollWeek.findFirst({
    where: { id: payrollWeekId, companyId: user.companyId },
  })
  if (!week) return { ok: false, message: 'No se encontró la semana.' }
  if (week.status === 'CLOSED') return { ok: false, message: 'Esta semana ya está cerrada.' }

  const universeIds = input.workers.map((row) => row.workerId)
  if (universeIds.length === 0) return { ok: true, message: 'No hay integrantes que anotar.' }

  const crewOf = new Map(input.workers.map((row) => [row.workerId, row.crewId]))
  const markedSet = new Set(input.marked.map((row) => `${row.workerId}:${row.date}`))

  const [existingControl, paidDays, crews] = await Promise.all([
    prisma.workEntry.findMany({
      where: {
        companyId: user.companyId,
        payrollWeekId,
        workerId: { in: universeIds },
        isControlOnly: true,
      },
    }),
    prisma.workEntry.findMany({
      where: {
        companyId: user.companyId,
        workerId: { in: universeIds },
        isControlOnly: false,
        workDate: { gte: week.startDate, lte: week.endDate },
      },
      select: { workerId: true, workDate: true, worker: { select: { displayName: true } } },
    }),
    prisma.crew.findMany({
      where: { id: { in: [...new Set(crewOf.values())] } },
      select: { id: true, projectId: true },
    }),
  ])
  const projectOfCrew = new Map(crews.map((crew) => [crew.id, crew.projectId]))
  const paidSet = new Map(
    paidDays.map((row) => [`${row.workerId}:${toIso(row.workDate)}`, row.worker.displayName]),
  )
  const existingSet = new Set(
    existingControl.map((row) => `${row.workerId}:${toIso(row.workDate)}`),
  )

  let created = 0
  let removed = 0
  const collisions: string[] = []

  await prisma.$transaction(async (tx) => {
    for (const key of markedSet) {
      if (existingSet.has(key)) continue
      const [workerId, date] = key.split(':') as [string, string]
      const paidName = paidSet.get(key)
      if (paidName) {
        collisions.push(`${paidName} ya tiene un día pagado el ${date}`)
        continue
      }
      const crewId = crewOf.get(workerId) ?? null
      await tx.workEntry.create({
        data: {
          companyId: user.companyId,
          payrollWeekId,
          workerId,
          workDate: new Date(`${date}T00:00:00Z`),
          dayType: 'FULL_DAY',
          isControlOnly: true,
          crewId,
          projectId: crewId ? (projectOfCrew.get(crewId) ?? null) : null,
          createdById: user.id,
        },
      })
      created += 1
    }

    for (const entry of existingControl) {
      const key = `${entry.workerId}:${toIso(entry.workDate)}`
      if (markedSet.has(key)) continue
      await tx.workEntry.delete({ where: { id: entry.id } })
      removed += 1
    }

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'CONTROL_DAYS_SAVED',
        entityType: 'PayrollWeek',
        entityId: payrollWeekId,
        payrollWeekId,
        newValueJson: { created, removed, collisions },
        changedFields: ['workEntries'],
        reason: 'Días de control de cuadrillas: no generan pago individual',
      },
    })
  })

  const summary = `${created} día(s) de control anotado(s), ${removed} quitado(s).`
  if (collisions.length > 0) {
    return {
      ok: true,
      message: `PARCIAL: ${summary} Se saltaron: ${collisions.join(' · ')} — un día de control no pisa un día pagado.`,
    }
  }
  return { ok: true, message: summary }
}

// ─────────────────────────────────────────────────────────────
// Lectura para la pantalla de la semana
// ─────────────────────────────────────────────────────────────

export interface CrewWeekView {
  crewId: string
  crewName: string
  contractorName: string | null
  hasContractor: boolean
  /** PRODUCTION = por pie construido · DAILY = precio fijo por día. */
  billingMode: 'PRODUCTION' | 'DAILY'
  /** Solo DAILY: cuánto se le paga por día. Nulo = falta definirlo. */
  dailyRate: string | null
  payable: {
    id: string
    total: string
    count: number
    status: string
  } | null
  members: ReadonlyArray<{ workerId: string; name: string }>
  /** Días de control ya marcados: `workerId:YYYY-MM-DD`. */
  controlDays: ReadonlyArray<string>
  /** Solo DAILY: días de la cuadrilla ya marcados, `crewId:YYYY-MM-DD`. */
  crewDays: ReadonlyArray<string>
  /** A qué obra se le carga esta semana. */
  projectId: string | null
}

/** Cuadrillas con producción o liquidación en la semana, listas para pintar. */
export async function weekCrewViews(
  companyId: string,
  payrollWeekId: string,
): Promise<CrewWeekView[]> {
  const week = await prisma.payrollWeek.findFirstOrThrow({
    where: { id: payrollWeekId, companyId },
  })

  const [production, payables, dayEntries, dailyCrews, escogidas] = await Promise.all([
    prisma.production.findMany({
      where: { companyId, payrollWeekId, crewId: { not: null } },
      select: { crewId: true },
    }),
    prisma.crewPayroll.findMany({ where: { companyId, payrollWeekId } }),
    prisma.crewDayEntry.findMany({ where: { companyId, payrollWeekId } }),
    /*
     * Las cuadrillas que cobran por día salen SIEMPRE, aunque todavía no
     * tengan días marcados: si no aparecieran hasta tener días, no habría
     * dónde marcarlos. Las de producción siguen apareciendo solo cuando hay
     * algo que liquidar — su producción se captura en otra pantalla.
     */
    prisma.crew.findMany({
      where: { companyId, active: true, billingMode: 'DAILY' },
      select: { id: true },
    }),
    // Las que alguien escogió liquidar esta semana, aunque todavía no tengan
    // producción capturada: es por donde se empieza a armarle la cuenta.
    prisma.crewWeekMember.findMany({
      where: { companyId, payrollWeekId },
      select: { crewId: true },
    }),
  ])

  const crewIds = [
    ...new Set([
      ...production.map((row) => row.crewId!),
      ...payables.map((row) => row.crewId),
      ...dayEntries.map((row) => row.crewId),
      ...dailyCrews.map((row) => row.id),
      ...escogidas.map((row) => row.crewId),
    ]),
  ]
  if (crewIds.length === 0) return []

  const [crews, memberships, defaultMembers, controlEntries] = await Promise.all([
    prisma.crew.findMany({
      where: { id: { in: crewIds } },
      include: { contractor: { select: { name: true } } },
    }),
    prisma.crewMembership.findMany({
      where: {
        crewId: { in: crewIds },
        from: { lte: week.endDate },
        OR: [{ to: null }, { to: { gte: week.startDate } }],
      },
      include: { worker: { select: { id: true, displayName: true, status: true } } },
    }),
    prisma.worker.findMany({
      where: { companyId, status: 'ACTIVE', defaultCrewId: { in: crewIds } },
      select: { id: true, displayName: true, defaultCrewId: true },
    }),
    prisma.workEntry.findMany({
      where: { companyId, payrollWeekId, isControlOnly: true },
      select: { workerId: true, workDate: true, crewId: true },
    }),
  ])

  const payableByCrew = new Map(payables.map((row) => [row.crewId, row]))

  return crews
    .map((crew) => {
      const members = new Map<string, string>()
      for (const membership of memberships) {
        if (membership.crewId === crew.id && membership.worker.status === 'ACTIVE') {
          members.set(membership.worker.id, membership.worker.displayName)
        }
      }
      for (const worker of defaultMembers) {
        if (worker.defaultCrewId === crew.id) members.set(worker.id, worker.displayName)
      }

      const payable = payableByCrew.get(crew.id)
      const memberIds = new Set(members.keys())

      const misDias = dayEntries.filter((entry) => entry.crewId === crew.id)

      return {
        crewId: crew.id,
        crewName: crew.name,
        contractorName: crew.contractor?.name ?? null,
        hasContractor: crew.contractorId !== null,
        billingMode: crew.billingMode === 'DAILY' ? ('DAILY' as const) : ('PRODUCTION' as const),
        dailyRate: crew.dailyRate ? crew.dailyRate.toFixed(2) : null,
        payable: payable
          ? {
              id: payable.id,
              total: payable.productionTotal.toFixed(2),
              count: payable.productionCount,
              status: payable.status,
            }
          : null,
        members: [...members.entries()]
          .map(([workerId, name]) => ({ workerId, name }))
          .sort((a, b) => a.name.localeCompare(b.name, 'es')),
        controlDays: controlEntries
          .filter((entry) => memberIds.has(entry.workerId))
          .map((entry) => `${entry.workerId}:${toIso(entry.workDate)}`),
        crewDays: misDias.map((entry) => `${crew.id}:${toIso(entry.workDate)}`),
        // La obra de la semana: la del primer día marcado, o la de la ficha.
        projectId: misDias.map((entry) => entry.projectId).find(Boolean) ?? crew.projectId,
      }
    })
    .sort((a, b) => a.crewName.localeCompare(b.crewName, 'es'))
}

// ─────────────────────────────────────────────────────────────
// Días de las cuadrillas que cobran POR DÍA
// ─────────────────────────────────────────────────────────────

export interface CrewDaysInput {
  /** Cuadrillas que se muestran en la rejilla: lo no marcado se borra. */
  crewIds: readonly string[]
  marked: ReadonlyArray<{ crewId: string; date: string }>
  /** A qué obra se le carga cada cuadrilla esta semana. */
  projects?: Readonly<Record<string, string>>
}

/**
 * Guarda los días de las cuadrillas que cobran un precio fijo por día.
 *
 * Es el gemelo de `saveEquipmentDays`: casilla marcada = día trabajado, y de
 * ahí sale la liquidación. La diferencia es a quién se le paga — al
 * CONTRATISTA, no a un proveedor.
 *
 * Una liquidación que ya movió dinero no se toca: primero se devuelve.
 */
export async function saveCrewDays(
  user: CurrentUser,
  payrollWeekId: string,
  input: CrewDaysInput,
): Promise<{ ok: boolean; message: string }> {
  const week = await prisma.payrollWeek.findFirst({
    where: { id: payrollWeekId, companyId: user.companyId },
  })
  if (!week) return { ok: false, message: 'No se encontró la semana.' }
  if (week.status === 'CLOSED') return { ok: false, message: 'Esta semana ya está cerrada.' }
  if (input.crewIds.length === 0) {
    return { ok: true, message: 'No hay cuadrillas por día que anotar.' }
  }

  const frozen = await prisma.crewPayroll.findMany({
    where: {
      companyId: user.companyId,
      payrollWeekId,
      crewId: { in: [...input.crewIds] },
      status: { in: ['PAYMENT_IN_PROCESS', 'PAID', 'RECONCILED', 'CLOSED'] },
    },
    select: { crewId: true, crewNameSnapshot: true },
  })
  const frozenIds = new Set(frozen.map((row) => row.crewId))

  const markedSet = new Set(
    input.marked
      .filter((row) => !frozenIds.has(row.crewId))
      .map((row) => `${row.crewId}:${row.date}`),
  )

  const current = await prisma.crewDayEntry.findMany({
    where: {
      companyId: user.companyId,
      payrollWeekId,
      crewId: { in: [...input.crewIds].filter((id) => !frozenIds.has(id)) },
    },
  })
  const currentSet = new Set(current.map((row) => `${row.crewId}:${toIso(row.workDate)}`))

  const proyectoDe = (crewId: string): string | null => input.projects?.[crewId] || null

  let created = 0
  let removed = 0
  let reproyectados = 0

  await prisma.$transaction(async (tx) => {
    for (const key of markedSet) {
      if (currentSet.has(key)) continue
      const [crewId, date] = key.split(':') as [string, string]
      await tx.crewDayEntry.create({
        data: {
          companyId: user.companyId,
          payrollWeekId,
          crewId,
          workDate: new Date(`${date}T00:00:00Z`),
          projectId: proyectoDe(crewId),
          createdById: user.id,
        },
      })
      created += 1
    }

    for (const entry of current) {
      const key = `${entry.crewId}:${toIso(entry.workDate)}`
      if (!markedSet.has(key)) {
        await tx.crewDayEntry.delete({ where: { id: entry.id } })
        removed += 1
        continue
      }
      // El día sigue, pero la cuadrilla pudo moverse de obra a mitad de semana.
      const nuevo = proyectoDe(entry.crewId)
      if (nuevo !== entry.projectId) {
        await tx.crewDayEntry.update({ where: { id: entry.id }, data: { projectId: nuevo } })
        reproyectados += 1
      }
    }

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'CREW_DAYS_SAVED',
        entityType: 'PayrollWeek',
        entityId: payrollWeekId,
        payrollWeekId,
        newValueJson: { created, removed, reproyectados },
        changedFields: ['crewDayEntries'],
        reason: 'Días de cuadrillas que cobran por día',
      },
    })
  })

  await reconcileCrewWeek(user.companyId, payrollWeekId)

  const summary =
    `${created} día(s) de cuadrilla anotado(s), ${removed} quitado(s)` +
    (reproyectados > 0 ? `, ${reproyectados} cambiado(s) de proyecto.` : '.')

  if (frozen.length > 0) {
    return {
      ok: true,
      message: `${summary} ${frozen.length} cuadrilla(s) no se tocaron: su liquidación ya movió dinero.`,
    }
  }
  return { ok: true, message: summary }
}

/**
 * Las cuadrillas que se pueden agregar a una semana.
 *
 * Todas las activas con contratista: al contratista es a quien se le paga, y
 * sin él la liquidación no pasa la puerta de aprobación (BR-240). Se marca
 * cuáles ya están en la semana para no ofrecerlas dos veces.
 */
export async function cuadrillasParaLaSemana(
  companyId: string,
  payrollWeekId: string,
): Promise<Array<{ id: string; name: string; contractorName: string | null; yaEsta: boolean }>> {
  const [crews, escogidas] = await Promise.all([
    prisma.crew.findMany({
      where: { companyId, active: true },
      include: { contractor: { select: { name: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.crewWeekMember.findMany({
      where: { companyId, payrollWeekId },
      select: { crewId: true },
    }),
  ])

  const ya = new Set(escogidas.map((row) => row.crewId))
  return crews.map((crew) => ({
    id: crew.id,
    name: crew.name,
    contractorName: crew.contractor?.name ?? null,
    yaEsta: ya.has(crew.id),
  }))
}

/**
 * Mete o saca una cuadrilla de la semana.
 *
 * Sacarla no borra nada: si ya tiene producción o liquidación, se niega y dice
 * por qué — la regla es la misma que para los equipos y vive en `week-roster`.
 */
export async function alternarCuadrillaEnSemana(
  user: CurrentUser,
  payrollWeekId: string,
  crewId: string,
): Promise<{ ok: boolean; message: string }> {
  const [crew, semana] = await Promise.all([
    prisma.crew.findFirst({
      where: { id: crewId, companyId: user.companyId },
      select: { id: true, name: true, contractorId: true },
    }),
    prisma.payrollWeek.findFirst({
      where: { id: payrollWeekId, companyId: user.companyId },
      select: { id: true, status: true },
    }),
  ])
  if (!crew) return { ok: false, message: 'Esa cuadrilla no existe en esta compañía.' }
  if (!semana) return { ok: false, message: 'Esa semana no existe en esta compañía.' }
  if (semana.status === 'CLOSED') {
    return { ok: false, message: 'La semana está cerrada: ya no se le agregan ni se le quitan cuadrillas.' }
  }

  const [miembro, produccion, liquidacion, dias] = await Promise.all([
    prisma.crewWeekMember.findUnique({
      where: { payrollWeekId_crewId: { payrollWeekId, crewId } },
    }),
    prisma.production.count({ where: { companyId: user.companyId, payrollWeekId, crewId } }),
    prisma.crewPayroll.findFirst({
      where: { companyId: user.companyId, payrollWeekId, crewId },
      select: { id: true },
    }),
    prisma.crewDayEntry.count({ where: { companyId: user.companyId, payrollWeekId, crewId } }),
  ])

  const estado = {
    id: crewId,
    escogido: miembro !== null,
    diasMarcados: produccion + dias,
    tieneLiquidacion: liquidacion !== null,
  }

  if (!estaEnLaSemana(estado)) {
    await prisma.crewWeekMember.create({
      data: { companyId: user.companyId, payrollWeekId, crewId, addedById: user.id },
    })
    return {
      ok: true,
      message: crew.contractorId
        ? `${crew.name} entra en esta semana. Captúrale la producción y calcula.`
        : `${crew.name} entra en esta semana, pero NO tiene contratista: sin él no se puede aprobar su pago. Asígnaselo en Catálogos → Cuadrillas.`,
    }
  }

  const veredicto = puedeSacarse(estado)
  if (!veredicto.puede) return { ok: false, message: `${crew.name}: ${veredicto.porque}` }

  await prisma.crewWeekMember.deleteMany({ where: { payrollWeekId, crewId } })
  return { ok: true, message: `${crew.name} sale de esta semana.` }
}

/**
 * A quién se le paga esa cuadrilla.
 *
 * Se puede hacer desde la semana, sin irse a Catálogos: doce de las
 * «cuadrillas» que trajo el Excel son en realidad equipos de trabajo internos
 * —CAMION, CUBO, DIRECCIONAL DRILL— y no tienen a nadie a quién pagarle.
 * Descubrirlo al momento de liquidar y tener que salir a otra pantalla para
 * arreglarlo es lo que hacía la lista inservible.
 *
 * Acepta el nombre de un contratista nuevo: si el que trabajó no está en el
 * catálogo, obligar a crearlo aparte es el mismo viaje que se está evitando.
 */
export async function asignarContratista(
  user: CurrentUser,
  input: { crewId: string; contractorId?: string | null; nombreNuevo?: string | null },
): Promise<{ ok: boolean; message: string }> {
  const crew = await prisma.crew.findFirst({
    where: { id: input.crewId, companyId: user.companyId },
    select: { id: true, name: true },
  })
  if (!crew) return { ok: false, message: 'Esa cuadrilla no existe en esta compañía.' }

  let contractorId = input.contractorId || null

  const nombre = (input.nombreNuevo ?? '').trim()
  if (!contractorId && nombre) {
    /*
     * Si ya existe uno con ese nombre se reutiliza. Crear «Hugo» dos veces
     * partiría en dos su historial de pagos, que es justo lo que nadie nota
     * hasta que le reclaman.
     */
    const existente = await prisma.contractor.findFirst({
      where: { companyId: user.companyId, name: nombre },
      select: { id: true },
    })
    contractorId =
      existente?.id ??
      (
        await prisma.contractor.create({
          data: { companyId: user.companyId, name: nombre, active: true },
          select: { id: true },
        })
      ).id
  }

  if (!contractorId) {
    return { ok: false, message: 'Escoge a quién se le paga, o escribe el nombre de uno nuevo.' }
  }

  const contratista = await prisma.contractor.findFirst({
    where: { id: contractorId, companyId: user.companyId },
    select: { id: true, name: true },
  })
  if (!contratista) return { ok: false, message: 'Ese contratista no existe en esta compañía.' }

  await prisma.crew.update({
    where: { id: crew.id },
    data: { contractorId: contratista.id },
  })

  return { ok: true, message: `A ${crew.name} se le paga a ${contratista.name}.` }
}
