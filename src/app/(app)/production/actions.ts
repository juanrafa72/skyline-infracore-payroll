'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { multiplyQuantity, toCents, toDecimalString } from '@/lib/payroll/engine'
import { periodOf } from '@/lib/payroll/period'

/**
 * Registra producción de una cuadrilla.
 *
 * El precio NO lo escribe quien captura: sale de la negociación vigente de esa
 * cuadrilla ese día. Si no hay negociación vigente, no se registra — igual que
 * con las tarifas de las personas, no se asume un precio en silencio.
 */
export async function recordProduction(_previous: string | null, formData: FormData): Promise<string> {
  await assertCan('payroll:create')
  const company = await getActiveCompany()

  const parsed = z
    .object({
      crewId: z.string().min(1, 'Elige la cuadrilla'),
      pricingId: z.string().min(1, 'Elige qué se produjo'),
      productionDate: z.string().min(1),
      quantity: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Cantidad con máximo 2 decimales'),
      notes: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(formData))

  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Datos inválidos'

  const pricing = await prisma.crewPricing.findFirst({
    where: { id: parsed.data.pricingId, companyId: company.id, active: true },
    include: { crew: true },
  })
  if (!pricing) return 'No se encontró ese precio.'

  const date = parsed.data.productionDate
  const from = pricing.effectiveFrom.toISOString().slice(0, 10)
  const to = pricing.effectiveTo?.toISOString().slice(0, 10)

  if (date < from || (to && date >= to)) {
    return `Ese precio no estaba vigente el ${date}. Vigencia: ${from} → ${to ?? 'sin fin'}.`
  }

  // El importe se calcula con el motor de dinero, en centavos, nunca con floats.
  const amount = multiplyQuantity(toCents(pricing.pricePerUnit.toString()), parsed.data.quantity)

  const period = periodOf(date, 'WEEKLY')
  const week = await prisma.payrollWeek.upsert({
    where: {
      companyId_year_weekNumber: {
        companyId: company.id,
        year: period.year,
        weekNumber: period.periodNumber,
      },
    },
    update: {},
    create: {
      companyId: company.id,
      year: period.year,
      weekNumber: period.periodNumber,
      startDate: new Date(`${period.startDate}T00:00:00Z`),
      endDate: new Date(`${period.endDate}T00:00:00Z`),
      label: period.label,
    },
  })

  const actor = await assertCan('payroll:create')

  await prisma.production.create({
    data: {
      companyId: company.id,
      payrollWeekId: week.id,
      crewId: pricing.crewId,
      projectId: pricing.projectId ?? pricing.crew.projectId,
      contractorId: pricing.crew.contractorId,
      productionDate: new Date(`${date}T00:00:00Z`),
      unitCode: pricing.unitCode,
      unitLabel: pricing.unitLabel,
      unitOfMeasure: pricing.unitOfMeasure,
      quantity: parsed.data.quantity,
      appliedPrice: pricing.pricePerUnit,
      pricingId: pricing.id,
      amount: toDecimalString(amount),
      notes: parsed.data.notes || null,
      createdById: actor.id,
    },
  })

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      userId: actor.id,
      userEmailSnapshot: actor.email,
      action: 'PRODUCTION_RECORDED',
      entityType: 'Crew',
      entityId: pricing.crewId,
      payrollWeekId: week.id,
      newValueJson: {
        unit: pricing.unitLabel,
        quantity: parsed.data.quantity,
        price: pricing.pricePerUnit.toString(),
        amount: toDecimalString(amount),
      },
      changedFields: ['production'],
    },
  })

  revalidatePath('/production')
  return `LISTO|${pricing.unitLabel}|${parsed.data.quantity}|${toDecimalString(amount)}`
}

export async function deleteProduction(formData: FormData) {
  const actor = await assertCan('payroll:edit')
  const company = await getActiveCompany()
  const id = String(formData.get('id') ?? '')

  const record = await prisma.production.findFirst({ where: { id, companyId: company.id } })
  if (!record) throw new Error('Registro no encontrado')

  await prisma.$transaction(async (tx) => {
    await tx.production.delete({ where: { id } })
    await tx.auditLog.create({
      data: {
        companyId: company.id,
        userId: actor.id,
        userEmailSnapshot: actor.email,
        action: 'PRODUCTION_DELETED',
        entityType: 'Crew',
        entityId: record.crewId ?? '',
        oldValueJson: {
          unit: record.unitLabel,
          quantity: record.quantity.toString(),
          amount: record.amount.toString(),
        },
        changedFields: ['production'],
      },
    })
  })

  revalidatePath('/production')
}
