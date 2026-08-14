'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'

/**
 * Tarifas de venta: lo que el cliente nos paga por un día trabajado.
 *
 * Nunca se editan ni se borran las vigentes. Cambiar un precio es **cerrar la
 * vigente y abrir una nueva desde la fecha del cambio** — así una semana ya
 * facturada sigue diciendo lo que decía. Es la misma regla que protege las
 * tarifas de costo (BR-032), aplicada al otro lado del negocio.
 */

const MONEY = /^\d+(\.\d{1,2})?$/

const schema = z.object({
  customerId: z.string().min(1, 'Escoge el cliente que paga'),
  amount: z.string().regex(MONEY, 'El monto va con máximo 2 decimales'),
  shift: z.enum(['ANY', 'DAY', 'NIGHT']),
  rateType: z.enum(['DAILY', 'HOURLY', 'WEEKLY', 'PIECE', 'PERCENTAGE']),
  effectiveFrom: z.string().min(1, 'Falta desde cuándo aplica'),
  projectId: z.string().optional(),
  operationId: z.string().optional(),
  crewId: z.string().optional(),
  sourceNote: z.string().trim().optional(),
})

function optional(value: string | undefined): string | null {
  return value && value !== '' ? value : null
}

export async function createBillingRate(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('rate:manage')
  const company = await getActiveCompany()

  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Faltan datos.'

  const data = parsed.data
  const from = new Date(`${data.effectiveFrom}T00:00:00Z`)

  const customer = await prisma.customer.findFirst({
    where: { id: data.customerId, companyId: company.id },
  })
  if (!customer) return 'Ese cliente no existe en esta compañía.'

  /*
   * Cerrar la anterior del MISMO alcance antes de abrir la nueva.
   *
   * Sin esto la base rechaza el solape —y hace bien—, pero el mensaje sería
   * un error de Postgres. Aquí se hace explícito: la vieja queda hasta el día
   * antes, la nueva arranca ese día.
   */
  const previous = await prisma.billingRate.findFirst({
    where: {
      companyId: company.id,
      customerId: data.customerId,
      rateType: data.rateType,
      shift: data.shift,
      projectId: optional(data.projectId),
      operationId: optional(data.operationId),
      crewId: optional(data.crewId),
      active: true,
      effectiveTo: null,
    },
  })

  if (previous) {
    if (previous.effectiveFrom >= from) {
      return `Ya hay una tarifa de ese mismo alcance vigente desde el ${previous.effectiveFrom
        .toISOString()
        .slice(0, 10)}. La nueva tiene que empezar después.`
    }
    const dayBefore = new Date(from)
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1)
    await prisma.billingRate.update({
      where: { id: previous.id },
      data: { effectiveTo: dayBefore },
    })
  }

  const created = await prisma.billingRate.create({
    data: {
      companyId: company.id,
      customerId: data.customerId,
      projectId: optional(data.projectId),
      operationId: optional(data.operationId),
      crewId: optional(data.crewId),
      shift: data.shift,
      rateType: data.rateType,
      amount: data.amount,
      effectiveFrom: from,
      sourceNote: data.sourceNote || null,
      createdById: user.id,
    },
  })

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      userId: user.id,
      userEmailSnapshot: user.email,
      action: 'BILLING_RATE_CREATED',
      entityType: 'BillingRate',
      entityId: created.id,
      // Prisma distingue "sin valor" de JSON null; para omitirlo va Prisma.DbNull.
      oldValueJson: previous
        ? { amount: previous.amount.toFixed(2), closedOn: data.effectiveFrom }
        : Prisma.DbNull,
      newValueJson: {
        customer: customer.name,
        amount: data.amount,
        shift: data.shift,
        from: data.effectiveFrom,
      },
      changedFields: ['amount', 'effectiveFrom'],
      reason: data.sourceNote || null,
    },
  })

  revalidatePath('/billing-rates')
  revalidatePath('/margin')

  return previous
    ? `LISTO|Tarifa nueva de $${data.amount} desde el ${data.effectiveFrom}. La anterior de $${previous.amount.toFixed(2)} quedó cerrada el día antes; las semanas ya calculadas no cambian.`
    : `LISTO|Tarifa de venta de $${data.amount} para ${customer.name}, desde el ${data.effectiveFrom}.`
}

/**
 * Desactiva una tarifa. No la borra.
 *
 * Las nóminas que ya la usaron guardan su propio snapshot, así que apagarla no
 * altera nada del pasado — solo deja de aplicarse de aquí en adelante.
 */
export async function deactivateBillingRate(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('rate:manage')
  const company = await getActiveCompany()
  const id = String(formData.get('rateId') ?? '')

  const rate = await prisma.billingRate.findFirst({
    where: { id, companyId: company.id },
    include: { customer: true },
  })
  if (!rate) return 'Esa tarifa no existe.'

  await prisma.billingRate.update({ where: { id }, data: { active: false } })

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      userId: user.id,
      userEmailSnapshot: user.email,
      action: 'BILLING_RATE_DEACTIVATED',
      entityType: 'BillingRate',
      entityId: id,
      oldValueJson: { amount: rate.amount.toFixed(2), customer: rate.customer.name },
      changedFields: ['active'],
    },
  })

  revalidatePath('/billing-rates')
  return `LISTO|Tarifa apagada. Lo ya calculado con ella no cambia.`
}
