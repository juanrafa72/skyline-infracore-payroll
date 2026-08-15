'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { multiplyQuantity, toCents, toDecimalString } from '@/lib/payroll/engine'
import { periodOf } from '@/lib/payroll/period'
import { reconcileCrewWeek } from '@/lib/payroll/crews/service'

/** Estados en los que la liquidación de la cuadrilla ya no admite cambios. */
const CREW_FROZEN = ['PAYMENT_IN_PROCESS', 'PAID', 'RECONCILED', 'CLOSED']

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

  /*
   * La VENTA de esta producción, congelada igual que el costo — BR-200.
   *
   * Si la negociación no tiene precio de venta, queda en NULL: no se sabe
   * cuánto se cobra, y eso NO es cero. El margen lo dirá en vez de inventarse
   * una utilidad del 100%.
   */
  const revenue = pricing.salePricePerUnit
    ? multiplyQuantity(toCents(pricing.salePricePerUnit.toString()), parsed.data.quantity)
    : null

  /*
   * La producción se cuelga de la semana EXISTENTE que contiene la fecha (así
   * cae en el mismo corte que los días de la gente, aunque el corte no sea
   * semanal). Solo si no hay ninguna se abre una con el período por defecto de
   * la compañía — antes estaba 'WEEKLY' a la fuerza.
   */
  const dateUtc = new Date(`${date}T00:00:00Z`)
  const containing = await prisma.payrollWeek.findFirst({
    where: {
      companyId: company.id,
      isOffCycle: false,
      startDate: { lte: dateUtc },
      endDate: { gte: dateUtc },
    },
    orderBy: { startDate: 'desc' },
  })

  const period = periodOf(date, company.defaultPayPeriod)
  const week =
    containing ??
    (await prisma.payrollWeek.upsert({
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
    }))

  /*
   * Si la liquidación de esa cuadrilla en esa semana ya movió dinero, aquí no
   * se agrega nada: lo pagado se corrige con un ajuste que deja rastro, no
   * cambiando el pasado.
   */
  const payable = await prisma.crewPayroll.findUnique({
    where: {
      companyId_payrollWeekId_crewId: {
        companyId: company.id,
        payrollWeekId: week.id,
        crewId: pricing.crewId,
      },
    },
  })
  if (payable && CREW_FROZEN.includes(payable.status)) {
    return `La liquidación de ${pricing.crew.name} en ${week.label} ya está pagada o en pago. No se puede agregar producción: corrígelo con un ajuste.`
  }

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
      appliedSalePrice: pricing.salePricePerUnit,
      revenue: revenue === null ? null : toDecimalString(revenue),
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
        salePrice: pricing.salePricePerUnit?.toString() ?? null,
        revenue: revenue === null ? null : toDecimalString(revenue),
      },
      changedFields: ['production'],
    },
  })

  /*
   * La liquidación de la cuadrilla se realinea de una vez; si estaba aprobada,
   * la aprobación se cae con rastro (jamás se corrige en silencio) y vuelve a
   * la mesa de quien aprueba.
   */
  await reconcileCrewWeek(company.id, week.id)

  revalidatePath('/production')
  revalidatePath('/margin')
  revalidatePath('/approvals')
  revalidatePath(`/payroll/${week.id}`)
  return `LISTO|${pricing.unitLabel}|${parsed.data.quantity}|${toDecimalString(amount)}|${
    revenue === null ? '' : toDecimalString(revenue)
  }`
}

/**
 * Borra un registro de producción — con las mismas guardas que crearlo.
 *
 * Hasta ahora borraba SIN ninguna guarda: se podía desaparecer producción de
 * una semana ya pagada sin que nada avisara. Ahora lo pagado se protege y lo
 * aprobado se invalida con rastro.
 */
export async function deleteProduction(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const actor = await assertCan('payroll:edit')
  const company = await getActiveCompany()
  const id = String(formData.get('id') ?? '')

  const record = await prisma.production.findFirst({ where: { id, companyId: company.id } })
  if (!record) return 'Ese registro de producción no existe.'

  if (record.payrollWeekId && record.crewId) {
    const payable = await prisma.crewPayroll.findUnique({
      where: {
        companyId_payrollWeekId_crewId: {
          companyId: company.id,
          payrollWeekId: record.payrollWeekId,
          crewId: record.crewId,
        },
      },
    })
    if (payable && CREW_FROZEN.includes(payable.status)) {
      return `La liquidación de esa cuadrilla ya está pagada o en pago. No se puede borrar su producción: corrígelo con un ajuste.`
    }
  }

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

  if (record.payrollWeekId) {
    await reconcileCrewWeek(company.id, record.payrollWeekId)
    revalidatePath(`/payroll/${record.payrollWeekId}`)
  }

  revalidatePath('/production')
  revalidatePath('/margin')
  revalidatePath('/approvals')
  return 'LISTO|Registro borrado. La liquidación de la cuadrilla quedó realineada.'
}
