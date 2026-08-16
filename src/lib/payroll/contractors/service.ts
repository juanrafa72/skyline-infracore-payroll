import type { CurrentUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { toCents, toDecimalString } from '@/lib/payroll/engine/money'
import { invalidateCrewIfStale } from '@/lib/payroll/workflow/payables'
import {
  calculateContractorWeek,
  memberAmount,
  type ContractorWeekResult,
  type MemberLine,
} from './index'

/**
 * El desglose y la conciliación de un contratista, contra la base de datos.
 *
 * La aritmética vive en `./index.ts`, que es puro y lo importa el navegador
 * para ir mostrando la cuenta mientras se escribe. Aquí solo lo que toca
 * Prisma.
 */

const EDITABLE = ['DRAFT', 'PREPARED', 'REJECTED'] as const

export interface ContractorResult {
  ok: boolean
  message: string
}

export interface MemberInput {
  /** Vacío al agregar; con id al editar uno existente. */
  id?: string | null
  workerId?: string | null
  name: string
  rateAmount: string
  quantity: string
  rateUnit?: string
  isContractor?: boolean
  notes?: string | null
}

/**
 * Guarda de una vez el desglose completo de una cuadrilla.
 *
 * Se reemplaza entero en vez de renglón por renglón: quien monta la nómina
 * edita la tabla como un todo —cambia una tarifa, borra a uno, agrega a otro—
 * y guardar por partes dejaría estados intermedios que no suman.
 *
 * No se toca una liquidación que ya salió a aprobación: se invalida con rastro
 * si el estado lo permite, igual que cualquier otro cambio material.
 */
export async function saveCrewBreakdown(
  user: CurrentUser,
  input: { crewPayrollId: string; members: readonly MemberInput[] },
): Promise<ContractorResult> {
  const payable = await prisma.crewPayroll.findFirst({
    where: { id: input.crewPayrollId, companyId: user.companyId },
  })
  if (!payable) return { ok: false, message: 'Esa liquidación no existe en esta compañía.' }

  if (!EDITABLE.includes(payable.status as (typeof EDITABLE)[number])) {
    if (payable.status === 'PAID' || payable.status === 'RECONCILED' || payable.status === 'CLOSED') {
      return {
        ok: false,
        message:
          'Esta liquidación ya se pagó: su desglose es el soporte de ese pago y no se cambia. ' +
          'Corrígelo con un ajuste.',
      }
    }
  }

  // Se valida TODO antes de escribir: guardar la mitad de una tabla dejaría un
  // desglose que no suma y el usuario no sabría cuál renglón falló.
  const parsed: Array<MemberInput & { amount: string }> = []
  for (const member of input.members) {
    const name = member.name.trim()
    if (!name) return { ok: false, message: 'Hay un renglón sin nombre. Escríbelo o quítalo.' }

    let amount: string
    try {
      amount = toDecimalString(
        memberAmount({
          name,
          rateAmount: member.rateAmount,
          quantity: member.quantity,
        } satisfies MemberLine),
      )
    } catch (error) {
      return {
        ok: false,
        message: `${name}: ${(error as Error).message}`,
      }
    }
    if (Number(amount) < 0) {
      return { ok: false, message: `${name}: el monto no puede ser negativo.` }
    }
    parsed.push({ ...member, name, amount })
  }

  await prisma.$transaction(async (tx) => {
    await tx.crewPayrollMember.deleteMany({ where: { crewPayrollId: payable.id } })
    if (parsed.length > 0) {
      await tx.crewPayrollMember.createMany({
        data: parsed.map((member) => ({
          companyId: user.companyId,
          crewPayrollId: payable.id,
          workerId: member.workerId || null,
          nameSnapshot: member.name,
          isContractor: member.isContractor ?? false,
          rateAmount: member.rateAmount,
          rateUnit: member.rateUnit || 'WEEK',
          quantity: member.quantity,
          amount: member.amount,
          notes: member.notes || null,
        })),
      })
    }

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'CREW_BREAKDOWN_SAVED',
        entityType: 'CrewPayroll',
        entityId: payable.id,
        payrollWeekId: payable.payrollWeekId,
        newValueJson: {
          renglones: parsed.length,
          total: parsed.reduce((sum, m) => sum + Number(m.amount), 0).toFixed(2),
        },
        changedFields: ['members'],
        reason: 'Desglose de la gente del contratista',
      },
    })
  })

  // El desglose no cambia lo que se paga (eso es la producción), pero sí el
  // soporte de la aprobación: quien aprobó vio otra tabla.
  await invalidateCrewIfStale(payable.id)

  return { ok: true, message: `Desglose guardado: ${parsed.length} renglón(es).` }
}

/**
 * Guarda lo que dice la fuente externa y deja constancia de quién concilió.
 *
 * NO ajusta nada: si no cuadra, la diferencia se muestra. «Cuadrar» en
 * silencio es exactamente lo que hacía perder plata en los Excel — regla 10.
 */
export async function saveExpectedTotal(
  user: CurrentUser,
  input: { crewPayrollId: string; expectedTotal: string; source?: string; note?: string },
): Promise<ContractorResult> {
  const payable = await prisma.crewPayroll.findFirst({
    where: { id: input.crewPayrollId, companyId: user.companyId },
  })
  if (!payable) return { ok: false, message: 'Esa liquidación no existe en esta compañía.' }

  const raw = input.expectedTotal.trim()

  // Vacío = se borra la conciliación. No es cero: cero significaría que la
  // fuente dice que no se le debe nada — regla 11.
  if (raw === '') {
    await prisma.crewPayroll.update({
      where: { id: payable.id },
      data: {
        expectedTotal: null,
        expectedSource: null,
        expectedNote: null,
        reconciledById: null,
        reconciledAt: null,
      },
    })
    return { ok: true, message: 'Se quitó la conciliación de esta cuadrilla.' }
  }

  let amount: string
  try {
    amount = toDecimalString(toCents(raw))
  } catch {
    return {
      ok: false,
      message: `«${raw}» no es un monto válido. Escríbelo como 5000.00`,
    }
  }
  if (Number(amount) < 0) return { ok: false, message: 'El monto no puede ser negativo.' }

  await prisma.$transaction(async (tx) => {
    await tx.crewPayroll.update({
      where: { id: payable.id },
      data: {
        expectedTotal: amount,
        expectedSource: input.source?.trim() || 'SharePoint',
        expectedNote: input.note?.trim() || null,
        reconciledById: user.id,
        reconciledAt: new Date(),
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'CREW_RECONCILED',
        entityType: 'CrewPayroll',
        entityId: payable.id,
        payrollWeekId: payable.payrollWeekId,
        oldValueJson: { expectedTotal: payable.expectedTotal?.toFixed(2) ?? null },
        newValueJson: { expectedTotal: amount, source: input.source ?? 'SharePoint' },
        changedFields: ['expectedTotal'],
        reason: input.note?.trim() || 'Conciliación contra la fuente externa',
      },
    })
  })

  const view = await contractorWeekView(user.companyId, payable.id)
  return { ok: true, message: view?.result.message ?? 'Conciliación guardada.' }
}

export interface ContractorWeekView {
  crewPayrollId: string
  crewName: string
  contractorName: string | null
  /** La semana que se está liquidando: «Semana 34 · 2026». */
  weekLabel: string
  status: string
  expectedTotal: string | null
  expectedSource: string | null
  expectedNote: string | null
  members: Array<{
    id: string
    workerId: string | null
    name: string
    rateAmount: string
    rateUnit: string
    quantity: string
    amount: string
    isContractor: boolean
  }>
  production: Array<{
    id: string
    quantity: string
    price: string
    amount: string
    unitLabel: string
    projectName: string | null
    date: string
  }>
  result: ContractorWeekResult
}

/** Todo lo que la pantalla necesita de un contratista en una semana. */
export async function contractorWeekView(
  companyId: string,
  crewPayrollId: string,
): Promise<ContractorWeekView | null> {
  const payable = await prisma.crewPayroll.findFirst({
    where: { id: crewPayrollId, companyId },
    include: {
      members: { orderBy: [{ isContractor: 'asc' }, { nameSnapshot: 'asc' }] },
      crew: { select: { name: true } },
      contractor: { select: { name: true } },
      payrollWeek: { select: { label: true, weekNumber: true, year: true } },
    },
  })
  if (!payable) return null

  const production = await prisma.production.findMany({
    where: { companyId, payrollWeekId: payable.payrollWeekId, crewId: payable.crewId },
    include: { project: { select: { name: true } } },
    orderBy: { productionDate: 'asc' },
  })

  const result = calculateContractorWeek({
    production: production.map((row) => ({
      quantity: row.quantity.toString(),
      price: row.appliedPrice.toString(),
      unitLabel: row.unitLabel,
      projectName: row.project?.name ?? null,
    })),
    members: payable.members.map((member) => ({
      name: member.nameSnapshot,
      rateAmount: member.rateAmount.toFixed(2),
      quantity: member.quantity.toString(),
      rateUnit: member.rateUnit,
      isContractor: member.isContractor,
    })),
    expectedTotal: payable.expectedTotal?.toFixed(2) ?? null,
  })

  return {
    crewPayrollId: payable.id,
    crewName: payable.crewNameSnapshot || payable.crew.name,
    contractorName: payable.contractorNameSnapshot ?? payable.contractor?.name ?? null,
    /*
     * El negocio trabaja por SEMANA, no por fecha suelta: «todo lo trabajamos
     * sobre semana». Toda la producción de esta liquidación es de la misma, así
     * que se dice una vez arriba en vez de repetir la fecha en cada renglón.
     */
    weekLabel: `${payable.payrollWeek.label ?? `Semana ${payable.payrollWeek.weekNumber}`} · ${payable.payrollWeek.year}`,
    status: payable.status,
    expectedTotal: payable.expectedTotal?.toFixed(2) ?? null,
    expectedSource: payable.expectedSource,
    expectedNote: payable.expectedNote,
    members: payable.members.map((member) => ({
      id: member.id,
      workerId: member.workerId,
      name: member.nameSnapshot,
      rateAmount: member.rateAmount.toFixed(2),
      rateUnit: member.rateUnit,
      quantity: member.quantity.toString(),
      amount: member.amount.toFixed(2),
      isContractor: member.isContractor,
    })),
    production: production.map((row) => ({
      id: row.id,
      quantity: row.quantity.toString(),
      price: row.appliedPrice.toString(),
      amount: row.amount.toFixed(2),
      unitLabel: row.unitLabel,
      projectName: row.project?.name ?? null,
      date: row.productionDate.toISOString().slice(0, 10),
    })),
    result,
  }
}

/**
 * Propone el desglose: primero el de la semana pasada, si lo hay.
 *
 * Ahorra volver a teclear la misma tabla cada semana — la gente de un
 * contratista y sus tarifas casi no cambian. Con las TARIFAS incluidas cuando
 * vienen de la semana anterior (ya se pactaron y se usaron), y en blanco
 * cuando salen del catálogo de la cuadrilla: ahí nadie ha dicho todavía cuánto
 * se le paga a cada quien, y un número inventado es peor que un campo vacío.
 *
 * Propone; nunca asigna. Quien monta la nómina revisa y guarda.
 */
export async function suggestBreakdown(
  companyId: string,
  crewPayrollId: string,
): Promise<
  Array<{
    workerId: string | null
    name: string
    isContractor: boolean
    rateAmount?: string
    quantity?: string
    rateUnit?: string
  }>
> {
  const payable = await prisma.crewPayroll.findFirst({
    where: { id: crewPayrollId, companyId },
    include: { contractor: { select: { name: true } } },
  })
  if (!payable) return []

  /*
   * La semana anterior de ESTA cuadrilla, si tuvo desglose. Se busca por fecha
   * de la semana, no por número: en enero la anterior es del año pasado.
   */
  const semanaActual = await prisma.payrollWeek.findUniqueOrThrow({
    where: { id: payable.payrollWeekId },
    select: { startDate: true },
  })
  const anterior = await prisma.crewPayroll.findFirst({
    where: {
      companyId,
      crewId: payable.crewId,
      id: { not: payable.id },
      payrollWeek: { startDate: { lt: semanaActual.startDate } },
      members: { some: {} },
    },
    include: { members: { orderBy: [{ isContractor: 'asc' }, { nameSnapshot: 'asc' }] } },
    orderBy: { payrollWeek: { startDate: 'desc' } },
  })

  if (anterior && anterior.members.length > 0) {
    return anterior.members.map((member) => ({
      workerId: member.workerId,
      name: member.nameSnapshot,
      isContractor: member.isContractor,
      rateAmount: member.rateAmount.toFixed(2),
      quantity: member.quantity.toString(),
      rateUnit: member.rateUnit,
    }))
  }

  const week = await prisma.payrollWeek.findUniqueOrThrow({
    where: { id: payable.payrollWeekId },
  })

  const [memberships, defaults] = await Promise.all([
    prisma.crewMembership.findMany({
      where: {
        crewId: payable.crewId,
        from: { lte: week.endDate },
        OR: [{ to: null }, { to: { gte: week.startDate } }],
      },
      include: { worker: { select: { id: true, displayName: true, status: true } } },
    }),
    prisma.worker.findMany({
      where: { companyId, status: 'ACTIVE', defaultCrewId: payable.crewId },
      select: { id: true, displayName: true },
    }),
  ])

  const gente = new Map<string, string>()
  for (const m of memberships) {
    if (m.worker.status === 'ACTIVE') gente.set(m.worker.id, m.worker.displayName)
  }
  for (const w of defaults) gente.set(w.id, w.displayName)

  const filas: Array<{
    workerId: string | null
    name: string
    isContractor: boolean
  }> = [...gente.entries()]
    .map(([workerId, name]) => ({ workerId, name, isContractor: false }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))

  // El contratista va de último y marcado: su parte también cuenta para que la
  // suma cuadre con lo que dice la fuente.
  const contractorName = payable.contractorNameSnapshot ?? payable.contractor?.name
  if (contractorName) {
    filas.push({ workerId: null, name: contractorName, isContractor: true })
  }

  return filas
}
