import { prisma } from '@/lib/db/client'
import type { CurrentUser } from '@/lib/auth/rbac'
import { equipmentTotal } from '@/lib/payroll/engine/payables'
import { toCents, toDecimalString } from '@/lib/payroll/engine/money'
import { invalidateEquipmentIfStale } from '@/lib/payroll/workflow/payables'
import { toIso } from '@/lib/payroll/week'

/**
 * Equipo rentado: sus días marcados se vuelven una liquidación semanal que se
 * le paga al PROVEEDOR del equipo — un equipo jamás recibe pagos (BR-121).
 *
 * Solo los equipos con ownership = RENTED generan liquidación. Los propios
 * (OWNED) son costo interno: no le deben nada a nadie (pregunta A14).
 */

const EDITABLE = ['DRAFT', 'PREPARED', 'REJECTED'] as const

export interface EquipmentSyncResult {
  ok: boolean
  synced: number
  untouched: Array<{ equipmentName: string; reason: string }>
}

/** Alinea las liquidaciones de equipo de la semana con sus días marcados. */
export async function syncEquipmentPayrolls(
  companyId: string,
  payrollWeekId: string,
): Promise<EquipmentSyncResult> {
  const entries = await prisma.equipmentEntry.findMany({
    where: { companyId, payrollWeekId },
  })

  const byEquipment = new Map<string, number>()
  for (const entry of entries) {
    byEquipment.set(entry.equipmentId, (byEquipment.get(entry.equipmentId) ?? 0) + 1)
  }

  const equipment = await prisma.equipment.findMany({
    where: { id: { in: [...byEquipment.keys()] } },
    include: { vendor: { select: { name: true } } },
  })
  const equipmentById = new Map(equipment.map((row) => [row.id, row]))

  const existing = await prisma.equipmentPayroll.findMany({
    where: { companyId, payrollWeekId },
  })
  const existingByEquipment = new Map(existing.map((row) => [row.equipmentId, row]))

  let synced = 0
  const untouched: EquipmentSyncResult['untouched'] = []

  for (const [equipmentId, daysTotal] of byEquipment) {
    const machine = equipmentById.get(equipmentId)
    if (!machine) continue

    const current = existingByEquipment.get(equipmentId)
    if (current && !EDITABLE.includes(current.status as (typeof EDITABLE)[number])) {
      untouched.push({
        equipmentName: machine.name,
        reason: 'su liquidación ya no es editable y no se recalcula en silencio',
      })
      continue
    }

    const dailyCost = machine.dailyCost ? toCents(machine.dailyCost.toFixed(2)) : null
    const total = dailyCost === null ? null : equipmentTotal(daysTotal, dailyCost)

    const payroll = await prisma.equipmentPayroll.upsert({
      where: {
        companyId_payrollWeekId_equipmentId: { companyId, payrollWeekId, equipmentId },
      },
      update: {
        status: 'PREPARED',
        daysTotal,
        appliedDailyCost: machine.dailyCost ?? 0,
        totalAmount: total === null ? 0 : toDecimalString(total),
        vendorId: machine.vendorId,
        equipmentNameSnapshot: machine.name,
        vendorNameSnapshot: machine.vendor?.name ?? null,
        preparedAt: new Date(),
      },
      create: {
        companyId,
        payrollWeekId,
        equipmentId,
        status: 'PREPARED',
        daysTotal,
        appliedDailyCost: machine.dailyCost ?? 0,
        totalAmount: total === null ? 0 : toDecimalString(total),
        vendorId: machine.vendorId,
        equipmentNameSnapshot: machine.name,
        vendorNameSnapshot: machine.vendor?.name ?? null,
        preparedAt: new Date(),
      },
    })
    synced += 1

    /*
     * Sin costo diario no hay cifra que pagar: error CRÍTICO que bloquea la
     * aprobación por el mismo conteo genérico que bloquea a las personas.
     * Jamás se paga $0.00 en silencio — la enfermedad de los Excel.
     */
    await prisma.exception.deleteMany({
      where: { companyId, entityType: 'EquipmentPayroll', entityId: payroll.id, status: 'OPEN' },
    })
    if (dailyCost === null) {
      await prisma.exception.create({
        data: {
          companyId,
          code: 'MISSING_RATE',
          level: 'CRITICAL',
          entityType: 'EquipmentPayroll',
          entityId: payroll.id,
          payrollWeekId,
          title: `Sin costo diario: ${machine.name}`,
          detail:
            'El equipo tiene días marcados pero no tiene costo diario configurado. ' +
            'Ponérselo en la pantalla de Equipos antes de enviar.',
        },
      })
    }
  }

  for (const row of existing) {
    if (byEquipment.has(row.equipmentId)) continue
    if (!EDITABLE.includes(row.status as (typeof EDITABLE)[number])) {
      untouched.push({
        equipmentName: row.equipmentNameSnapshot,
        reason: 'se quedó sin días pero su liquidación ya no es editable',
      })
      continue
    }
    await prisma.exception.deleteMany({
      where: { companyId, entityType: 'EquipmentPayroll', entityId: row.id, status: 'OPEN' },
    })
    await prisma.equipmentPayroll.delete({ where: { id: row.id } })
  }

  return { ok: true, synced, untouched }
}

/** Tras cambiar días: realinear e invalidar (con rastro) lo aprobado. */
export async function reconcileEquipmentWeek(
  companyId: string,
  payrollWeekId: string,
): Promise<void> {
  await syncEquipmentPayrolls(companyId, payrollWeekId)
  const approved = await prisma.equipmentPayroll.findMany({
    where: { companyId, payrollWeekId, status: { in: ['APPROVED', 'READY_TO_PAY'] } },
    select: { id: true },
  })
  for (const payroll of approved) {
    await invalidateEquipmentIfStale(payroll.id)
  }
}

export interface EquipmentDaysResult {
  ok: boolean
  message: string
}

/**
 * Guarda los días del equipo rentado: casilla marcada = día rentado.
 *
 * Las liquidaciones que ya no son editables no se tocan por aquí: primero se
 * devuelven. Los cambios sobre lo aprobado tumban la aprobación con rastro.
 */
export async function saveEquipmentDays(
  user: CurrentUser,
  payrollWeekId: string,
  input: {
    equipmentIds: readonly string[]
    marked: ReadonlyArray<{ equipmentId: string; date: string }>
  },
): Promise<EquipmentDaysResult> {
  const week = await prisma.payrollWeek.findFirst({
    where: { id: payrollWeekId, companyId: user.companyId },
  })
  if (!week) return { ok: false, message: 'No se encontró la semana.' }
  if (week.status === 'CLOSED') return { ok: false, message: 'Esta semana ya está cerrada.' }

  if (input.equipmentIds.length === 0) {
    return { ok: true, message: 'No hay equipos rentados que anotar.' }
  }

  const frozen = await prisma.equipmentPayroll.findMany({
    where: {
      companyId: user.companyId,
      payrollWeekId,
      equipmentId: { in: [...input.equipmentIds] },
      status: { in: ['PAYMENT_IN_PROCESS', 'PAID', 'RECONCILED', 'CLOSED'] },
    },
    select: { equipmentId: true, equipmentNameSnapshot: true },
  })
  const frozenIds = new Set(frozen.map((row) => row.equipmentId))

  const markedSet = new Set(
    input.marked
      .filter((row) => !frozenIds.has(row.equipmentId))
      .map((row) => `${row.equipmentId}:${row.date}`),
  )

  const current = await prisma.equipmentEntry.findMany({
    where: {
      companyId: user.companyId,
      payrollWeekId,
      equipmentId: { in: [...input.equipmentIds].filter((id) => !frozenIds.has(id)) },
    },
  })
  const currentSet = new Set(current.map((row) => `${row.equipmentId}:${toIso(row.workDate)}`))

  let created = 0
  let removed = 0

  await prisma.$transaction(async (tx) => {
    for (const key of markedSet) {
      if (currentSet.has(key)) continue
      const [equipmentId, date] = key.split(':') as [string, string]
      await tx.equipmentEntry.create({
        data: {
          companyId: user.companyId,
          payrollWeekId,
          equipmentId,
          workDate: new Date(`${date}T00:00:00Z`),
          createdById: user.id,
        },
      })
      created += 1
    }

    for (const entry of current) {
      const key = `${entry.equipmentId}:${toIso(entry.workDate)}`
      if (markedSet.has(key)) continue
      await tx.equipmentEntry.delete({ where: { id: entry.id } })
      removed += 1
    }

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'EQUIPMENT_DAYS_SAVED',
        entityType: 'PayrollWeek',
        entityId: payrollWeekId,
        payrollWeekId,
        newValueJson: { created, removed },
        changedFields: ['equipmentEntries'],
      },
    })
  })

  await reconcileEquipmentWeek(user.companyId, payrollWeekId)

  const summary = `${created} día(s) de equipo anotado(s), ${removed} quitado(s).`
  if (frozen.length > 0) {
    return {
      ok: true,
      message: `${summary} ${frozen.length} equipo(s) no se tocaron: su liquidación ya movió dinero.`,
    }
  }
  return { ok: true, message: summary }
}

export interface EquipmentWeekView {
  equipmentId: string
  name: string
  kindLabel: string
  dailyCost: string | null
  vendorName: string | null
  hasVendor: boolean
  payable: { id: string; total: string; days: number; status: string } | null
  /** Días marcados: `equipmentId:YYYY-MM-DD`. */
  markedDays: ReadonlyArray<string>
}

/** Equipos RENTADOS activos con sus días y liquidación de la semana. */
export async function weekEquipmentViews(
  companyId: string,
  payrollWeekId: string,
): Promise<EquipmentWeekView[]> {
  const [machines, entries, payables] = await Promise.all([
    prisma.equipment.findMany({
      where: { companyId, ownership: 'RENTED', status: 'ACTIVE' },
      include: { vendor: { select: { name: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.equipmentEntry.findMany({ where: { companyId, payrollWeekId } }),
    prisma.equipmentPayroll.findMany({ where: { companyId, payrollWeekId } }),
  ])

  const payableByEquipment = new Map(payables.map((row) => [row.equipmentId, row]))
  const daysByEquipment = new Map<string, string[]>()
  for (const entry of entries) {
    const list = daysByEquipment.get(entry.equipmentId) ?? []
    list.push(`${entry.equipmentId}:${toIso(entry.workDate)}`)
    daysByEquipment.set(entry.equipmentId, list)
  }

  const KIND: Record<string, string> = { MACHINE: 'Máquina', VEHICLE: 'Vehículo', TOOL: 'Herramienta' }

  return machines.map((machine) => {
    const payable = payableByEquipment.get(machine.id)
    return {
      equipmentId: machine.id,
      name: machine.name,
      kindLabel: KIND[machine.kind] ?? machine.kind,
      dailyCost: machine.dailyCost ? machine.dailyCost.toFixed(2) : null,
      vendorName: machine.vendor?.name ?? null,
      hasVendor: machine.vendorId !== null,
      payable: payable
        ? {
            id: payable.id,
            total: payable.totalAmount.toFixed(2),
            days: payable.daysTotal,
            status: payable.status,
          }
        : null,
      markedDays: daysByEquipment.get(machine.id) ?? [],
    }
  })
}
