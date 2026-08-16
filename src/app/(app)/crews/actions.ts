'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'

const MONEY4 = /^\d+(\.\d{1,4})?$/

/**
 * Negociación por unidad de una cuadrilla: los DOS precios.
 *
 * `pricePerUnit` es lo que le pagamos a la cuadrilla; `salePricePerUnit` lo que
 * el cliente nos paga por esa misma unidad. Ejemplo real: nos pagan $1.00 por
 * pie construido y a la cuadrilla le pagamos $0.50.
 *
 * El precio de venta es opcional — muchas veces se pacta el costo antes de
 * cerrar la venta — pero si se pone, hay que decir quién paga: un precio de
 * venta sin cliente no se le puede cobrar a nadie (BR-211, y la base también
 * lo impide).
 */
export async function createCrewPricing(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const company = await getActiveCompany()
  const parsed = z
    .object({
      crewId: z.string().min(1),
      unitCode: z.string().trim().min(1),
      unitLabel: z.string().trim().min(1),
      unitOfMeasure: z.string().trim().min(1),
      pricePerUnit: z.string().regex(MONEY4, 'El precio de costo va con máximo 4 decimales'),
      salePricePerUnit: z.string().trim().optional(),
      customerId: z.string().trim().optional(),
      projectId: z.string().trim().optional(),
      effectiveFrom: z.string().min(1),
      effectiveTo: z.string().trim().optional(),
      notes: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(formData))

  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Faltan datos.'
  const data = parsed.data

  const sale = data.salePricePerUnit?.trim() || null
  if (sale && !MONEY4.test(sale)) {
    return 'El precio de venta va con máximo 4 decimales.'
  }
  if (sale && !data.customerId) {
    return 'Si pones precio de venta, di quién lo paga: sin cliente no hay a quién cobrárselo.'
  }

  // Avisar cuando la negociación deja pérdida. No se bloquea —a veces se hace
  // a propósito— pero nadie debería guardarla sin darse cuenta.
  const losing = sale !== null && Number(sale) < Number(data.pricePerUnit)

  await prisma.crewPricing.create({
    data: {
      companyId: company.id,
      crewId: data.crewId,
      unitCode: data.unitCode.toUpperCase(),
      unitLabel: data.unitLabel,
      unitOfMeasure: data.unitOfMeasure,
      pricePerUnit: data.pricePerUnit,
      salePricePerUnit: sale,
      customerId: sale ? data.customerId! : null,
      projectId: data.projectId || null,
      effectiveFrom: new Date(`${data.effectiveFrom}T00:00:00Z`),
      effectiveTo: data.effectiveTo ? new Date(`${data.effectiveTo}T00:00:00Z`) : null,
      notes: data.notes || null,
    },
  })

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      action: 'CREW_PRICING_CREATED',
      entityType: 'Crew',
      entityId: data.crewId,
      newValueJson: { unit: data.unitLabel, cost: data.pricePerUnit, sale },
      changedFields: ['pricing'],
    },
  })

  revalidatePath(`/crews/${data.crewId}`)
  revalidatePath('/margin')

  if (!sale) {
    return `LISTO|${data.unitLabel}: costo $${data.pricePerUnit} por ${data.unitOfMeasure.toLowerCase()}. Sin precio de venta todavía, así que esta unidad no suma margen.`
  }
  const margin = (Number(sale) - Number(data.pricePerUnit)).toFixed(4)
  return losing
    ? `LISTO|OJO: ${data.unitLabel} deja PÉRDIDA de $${Math.abs(Number(margin)).toFixed(4)} por unidad — se paga $${data.pricePerUnit} y se cobra $${sale}. Quedó guardado.`
    : `LISTO|${data.unitLabel}: se cobra $${sale} y se paga $${data.pricePerUnit} · deja $${margin} por ${data.unitOfMeasure.toLowerCase()}.`
}

export async function addCrewMember(formData: FormData) {
  const company = await getActiveCompany()
  const parsed = z
    .object({
      crewId: z.string().min(1),
      workerId: z.string().min(1),
      role: z.enum(['LEADER', 'MEMBER']),
      from: z.string().min(1),
    })
    .parse(Object.fromEntries(formData))

  const crew = await prisma.crew.findFirst({
    where: { id: parsed.crewId, companyId: company.id },
  })
  if (!crew) throw new Error('Cuadrilla no encontrada')

  await prisma.$transaction(async (tx) => {
    // Una cuadrilla tiene un solo encargado vigente (BR-112).
    if (parsed.role === 'LEADER') {
      await tx.crewMembership.updateMany({
        where: { crewId: crew.id, role: 'LEADER', to: null },
        data: { to: new Date(`${parsed.from}T00:00:00Z`) },
      })
      const worker = await tx.worker.findUnique({ where: { id: parsed.workerId } })
      await tx.crew.update({
        where: { id: crew.id },
        data: { leaderWorkerId: parsed.workerId, leaderName: worker?.displayName ?? null },
      })
    }

    await tx.crewMembership.create({
      data: {
        crewId: crew.id,
        workerId: parsed.workerId,
        role: parsed.role,
        from: new Date(`${parsed.from}T00:00:00Z`),
      },
    })
  })

  revalidatePath(`/crews/${parsed.crewId}`)
}

export async function endCrewMembership(formData: FormData) {
  const company = await getActiveCompany()
  const membershipId = String(formData.get('membershipId') ?? '')
  const crewId = String(formData.get('crewId') ?? '')
  const to = String(formData.get('to') ?? '')

  const crew = await prisma.crew.findFirst({ where: { id: crewId, companyId: company.id } })
  if (!crew) throw new Error('Cuadrilla no encontrada')

  await prisma.crewMembership.update({
    where: { id: membershipId },
    data: { to: new Date(`${to}T00:00:00Z`) },
  })
  revalidatePath(`/crews/${crewId}`)
}

/** Enciende o apaga el seguimiento de la contabilidad interna de la cuadrilla. */
export async function toggleInternalAccounting(formData: FormData) {
  const company = await getActiveCompany()
  const crewId = String(formData.get('crewId') ?? '')
  const enable = String(formData.get('enable') ?? '') === '1'

  const crew = await prisma.crew.findFirst({ where: { id: crewId, companyId: company.id } })
  if (!crew) throw new Error('Cuadrilla no encontrada')

  await prisma.crew.update({
    where: { id: crew.id },
    data: { tracksInternalAccounting: enable },
  })

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      action: enable ? 'CREW_INTERNAL_ACCOUNTING_ON' : 'CREW_INTERNAL_ACCOUNTING_OFF',
      entityType: 'Crew',
      entityId: crew.id,
      oldValueJson: { tracksInternalAccounting: crew.tracksInternalAccounting },
      newValueJson: { tracksInternalAccounting: enable },
      changedFields: ['tracksInternalAccounting'],
    },
  })

  revalidatePath(`/crews/${crewId}`)
}

/**
 * Cómo se reparte internamente la cuadrilla.
 *
 * Esto NO es nómina de la compañía: es el apoyo contable que se le da al
 * subcontratista. No genera pagos por sí solo.
 */
export async function setCrewShare(formData: FormData) {
  const company = await getActiveCompany()
  const parsed = z
    .object({
      crewId: z.string().min(1),
      workerId: z.string().min(1),
      shareType: z.enum(['PERCENTAGE', 'PER_UNIT', 'FIXED_DAILY']),
      value: z.string().regex(MONEY4, 'Valor con máximo 4 decimales'),
      role: z.string().trim().optional(),
      effectiveFrom: z.string().min(1),
      notes: z.string().trim().optional(),
    })
    .parse(Object.fromEntries(formData))

  const crew = await prisma.crew.findFirst({
    where: { id: parsed.crewId, companyId: company.id },
  })
  if (!crew) throw new Error('Cuadrilla no encontrada')
  if (!crew.tracksInternalAccounting) {
    throw new Error(
      'Esta cuadrilla no tiene activado el seguimiento de contabilidad interna. Actívalo primero.',
    )
  }

  await prisma.$transaction(async (tx) => {
    // Se cierra el reparto anterior de esa persona antes de abrir el nuevo,
    // para que no queden dos vigentes al mismo tiempo.
    await tx.crewMemberShare.updateMany({
      where: { crewId: crew.id, workerId: parsed.workerId, effectiveTo: null, active: true },
      data: { effectiveTo: new Date(`${parsed.effectiveFrom}T00:00:00Z`) },
    })

    await tx.crewMemberShare.create({
      data: {
        companyId: company.id,
        crewId: crew.id,
        workerId: parsed.workerId,
        shareType: parsed.shareType,
        value: parsed.value,
        role: parsed.role || null,
        effectiveFrom: new Date(`${parsed.effectiveFrom}T00:00:00Z`),
        notes: parsed.notes || null,
      },
    })
  })

  revalidatePath(`/crews/${parsed.crewId}`)
}

/**
 * Cómo cobra la cuadrilla y a quién se le paga.
 *
 * Dos datos que van juntos porque se deciden juntos: si cobra por pie
 * construido o un precio fijo por día, y quién es el contratista que recibe el
 * dinero (BR-242). Sin contratista no se puede aprobar, y sin tarifa diaria
 * una cuadrilla de cobro diario no calcula.
 */
export async function setCrewBilling(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('crew:manage')
  const company = await getActiveCompany()
  const crewId = String(formData.get('crewId') ?? '')

  const crew = await prisma.crew.findFirst({ where: { id: crewId, companyId: company.id } })
  if (!crew) return 'Esa cuadrilla no existe en esta compañía.'

  const billingMode = String(formData.get('billingMode') ?? 'PRODUCTION') === 'DAILY'
    ? 'DAILY'
    : 'PRODUCTION'
  const contractorId = String(formData.get('contractorId') ?? '') || null

  let dailyRate: string | null = null
  const raw = String(formData.get('dailyRate') ?? '').trim()
  if (billingMode === 'DAILY' && raw !== '') {
    const limpio = raw.replace(/[$\s,]/g, '')
    if (!/^\d+(\.\d{1,2})?$/.test(limpio)) {
      return `«${raw}» no es un monto válido. Escríbelo como 800.00`
    }
    dailyRate = Number(limpio).toFixed(2)
  }

  await prisma.$transaction(async (tx) => {
    await tx.crew.update({
      where: { id: crew.id },
      // La tarifa diaria se conserva al volver a producción: si mañana cambia
      // de opinión, no tiene que volver a teclearla.
      data: { billingMode, contractorId, ...(dailyRate !== null ? { dailyRate } : {}) },
    })

    await tx.auditLog.create({
      data: {
        companyId: company.id,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'CREW_BILLING_UPDATED',
        entityType: 'Crew',
        entityId: crew.id,
        oldValueJson: {
          billingMode: crew.billingMode,
          dailyRate: crew.dailyRate?.toFixed(2) ?? null,
          contractorId: crew.contractorId,
        },
        newValueJson: { billingMode, dailyRate, contractorId },
        changedFields: ['billingMode', 'dailyRate', 'contractorId'],
        reason: 'Cómo cobra la cuadrilla y a quién se le paga',
      },
    })
  })

  revalidatePath(`/crews/${crewId}`)
  revalidatePath('/crews')

  return billingMode === 'DAILY'
    ? `LISTO|${crew.name} cobra ${dailyRate ? `$${dailyRate}` : '(falta la tarifa)'} por día.`
    : `LISTO|${crew.name} cobra por producción.`
}
