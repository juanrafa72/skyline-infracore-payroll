import { prisma } from '@/lib/db/client'
import type { CurrentUser } from '@/lib/auth/rbac'
import { sumProductionAmounts } from '@/lib/payroll/engine/payables'
import { toDecimalString } from '@/lib/payroll/engine/money'
import { invalidateCrewIfStale } from '@/lib/payroll/workflow/payables'
import { toIso } from '@/lib/payroll/week'

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
  const production = await prisma.production.findMany({
    where: { companyId, payrollWeekId, crewId: { not: null } },
    orderBy: { productionDate: 'asc' },
  })

  const byCrew = new Map<string, typeof production>()
  for (const row of production) {
    const list = byCrew.get(row.crewId!) ?? []
    list.push(row)
    byCrew.set(row.crewId!, list)
  }

  const crews = await prisma.crew.findMany({
    where: { id: { in: [...byCrew.keys()] } },
    include: { contractor: { select: { id: true, name: true } } },
  })
  const crewById = new Map(crews.map((crew) => [crew.id, crew]))

  const existing = await prisma.crewPayroll.findMany({
    where: { companyId, payrollWeekId },
  })
  const existingByCrew = new Map(existing.map((row) => [row.crewId, row]))

  let synced = 0
  const untouched: SyncResult['untouched'] = []

  for (const [crewId, rows] of byCrew) {
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

    const total = sumProductionAmounts(rows.map((row) => row.amount.toFixed(2)))

    await prisma.crewPayroll.upsert({
      where: {
        companyId_payrollWeekId_crewId: { companyId, payrollWeekId, crewId },
      },
      update: {
        status: 'PREPARED',
        productionTotal: toDecimalString(total),
        productionCount: rows.length,
        contractorId: crew.contractorId,
        crewNameSnapshot: crew.name,
        contractorNameSnapshot: crew.contractor?.name ?? null,
        preparedAt: new Date(),
      },
      create: {
        companyId,
        payrollWeekId,
        crewId,
        status: 'PREPARED',
        productionTotal: toDecimalString(total),
        productionCount: rows.length,
        contractorId: crew.contractorId,
        crewNameSnapshot: crew.name,
        contractorNameSnapshot: crew.contractor?.name ?? null,
        preparedAt: new Date(),
      },
    })
    synced += 1
  }

  // Cuadrillas que se quedaron sin producción esta semana.
  for (const row of existing) {
    if (byCrew.has(row.crewId)) continue
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
  payable: {
    id: string
    total: string
    count: number
    status: string
  } | null
  members: ReadonlyArray<{ workerId: string; name: string }>
  /** Días de control ya marcados: `workerId:YYYY-MM-DD`. */
  controlDays: ReadonlyArray<string>
}

/** Cuadrillas con producción o liquidación en la semana, listas para pintar. */
export async function weekCrewViews(
  companyId: string,
  payrollWeekId: string,
): Promise<CrewWeekView[]> {
  const week = await prisma.payrollWeek.findFirstOrThrow({
    where: { id: payrollWeekId, companyId },
  })

  const [production, payables] = await Promise.all([
    prisma.production.findMany({
      where: { companyId, payrollWeekId, crewId: { not: null } },
      select: { crewId: true },
    }),
    prisma.crewPayroll.findMany({ where: { companyId, payrollWeekId } }),
  ])

  const crewIds = [
    ...new Set([...production.map((row) => row.crewId!), ...payables.map((row) => row.crewId)]),
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

      return {
        crewId: crew.id,
        crewName: crew.name,
        contractorName: crew.contractor?.name ?? null,
        hasContractor: crew.contractorId !== null,
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
      }
    })
    .sort((a, b) => a.crewName.localeCompare(b.crewName, 'es'))
}
