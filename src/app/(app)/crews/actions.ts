'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'

const MONEY4 = /^\d+(\.\d{1,4})?$/

/** Precio pactado por unidad: strand $0.15, fibra $0.20, etc. */
export async function createCrewPricing(formData: FormData) {
  const company = await getActiveCompany()
  const parsed = z
    .object({
      crewId: z.string().min(1),
      unitCode: z.string().trim().min(1),
      unitLabel: z.string().trim().min(1),
      unitOfMeasure: z.string().trim().min(1),
      pricePerUnit: z.string().regex(MONEY4, 'Precio con máximo 4 decimales'),
      projectId: z.string().trim().optional(),
      effectiveFrom: z.string().min(1),
      effectiveTo: z.string().trim().optional(),
      notes: z.string().trim().optional(),
    })
    .parse(Object.fromEntries(formData))

  await prisma.crewPricing.create({
    data: {
      companyId: company.id,
      crewId: parsed.crewId,
      unitCode: parsed.unitCode.toUpperCase(),
      unitLabel: parsed.unitLabel,
      unitOfMeasure: parsed.unitOfMeasure,
      pricePerUnit: parsed.pricePerUnit,
      projectId: parsed.projectId || null,
      effectiveFrom: new Date(`${parsed.effectiveFrom}T00:00:00Z`),
      effectiveTo: parsed.effectiveTo ? new Date(`${parsed.effectiveTo}T00:00:00Z`) : null,
      notes: parsed.notes || null,
    },
  })

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      action: 'CREW_PRICING_CREATED',
      entityType: 'Crew',
      entityId: parsed.crewId,
      newValueJson: { unit: parsed.unitLabel, price: parsed.pricePerUnit },
      changedFields: ['pricing'],
    },
  })

  revalidatePath(`/crews/${parsed.crewId}`)
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
