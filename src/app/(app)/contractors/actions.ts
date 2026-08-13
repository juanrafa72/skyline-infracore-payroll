'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'

const MONEY = /^\d+(\.\d{1,2})?$/

export async function createContractor(formData: FormData) {
  const company = await getActiveCompany()
  const parsed = z
    .object({
      name: z.string().trim().min(1),
      legalName: z.string().trim().optional(),
      contactName: z.string().trim().optional(),
      phone: z.string().trim().optional(),
      commissionPct: z.string().trim().optional(),
    })
    .parse(Object.fromEntries(formData))

  const contractor = await prisma.contractor.create({
    data: {
      companyId: company.id,
      name: parsed.name,
      legalName: parsed.legalName || null,
      contactName: parsed.contactName || null,
      phone: parsed.phone || null,
      commissionPct: parsed.commissionPct || null,
    },
  })

  revalidatePath('/contractors')
  redirect(`/contractors/${contractor.id}`)
}

/**
 * Préstamo o adelanto a un contratista.
 *
 * El monto original queda congelado (BR-081). Lo que se recupere después son
 * movimientos aparte, para que siempre se pueda ver cuánto se prestó, cuánto
 * se ha descontado y cuánto falta.
 */
export async function createContractorAdvance(formData: FormData) {
  const company = await getActiveCompany()
  const parsed = z
    .object({
      contractorId: z.string().min(1),
      amount: z.string().regex(MONEY, 'Monto con máximo 2 decimales'),
      requestDate: z.string().min(1),
      reason: z.string().trim().min(1, 'El motivo es obligatorio'),
      recoveryMethod: z.enum(['MANUAL', 'FIXED_WEEKLY', 'LUMP_SUM']),
      recoveryAmount: z.string().trim().optional(),
    })
    .parse(Object.fromEntries(formData))

  const advance = await prisma.advance.create({
    data: {
      companyId: company.id,
      beneficiaryType: 'CONTRACTOR',
      contractorId: parsed.contractorId,
      amount: parsed.amount,
      requestDate: new Date(`${parsed.requestDate}T00:00:00Z`),
      reason: parsed.reason,
      recoveryMethod: parsed.recoveryMethod,
      recoveryAmount:
        parsed.recoveryMethod === 'FIXED_WEEKLY' && parsed.recoveryAmount
          ? parsed.recoveryAmount
          : null,
      status: 'ACTIVE',
    },
  })

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      action: 'CONTRACTOR_ADVANCE_CREATED',
      entityType: 'Advance',
      entityId: advance.id,
      newValueJson: { amount: parsed.amount, contractorId: parsed.contractorId },
      changedFields: ['amount'],
      reason: parsed.reason,
    },
  })

  revalidatePath(`/contractors/${parsed.contractorId}`)
}

/**
 * Registra cuánto se le descuenta de lo prestado.
 *
 * El monto lo decide una persona, no el sistema: por eso se captura a mano.
 * Lo que el sistema sí impide es descontar más de lo que se debe.
 */
export async function recordContractorRecovery(formData: FormData) {
  const company = await getActiveCompany()
  const parsed = z
    .object({
      advanceId: z.string().min(1),
      contractorId: z.string().min(1),
      amount: z.string().regex(MONEY, 'Monto con máximo 2 decimales'),
      notes: z.string().trim().optional(),
    })
    .parse(Object.fromEntries(formData))

  const advance = await prisma.advance.findFirst({
    where: { id: parsed.advanceId, companyId: company.id },
    include: { recoveries: true },
  })
  if (!advance) throw new Error('Adelanto no encontrado')

  const recovered = advance.recoveries.reduce((sum, row) => sum + Number(row.amount), 0)
  const balance = Number(advance.amount) - recovered
  const requested = Number(parsed.amount)

  if (requested > balance) {
    throw new Error(
      `No se puede descontar $${requested.toFixed(2)}: el saldo pendiente es $${balance.toFixed(2)}.`,
    )
  }

  await prisma.$transaction(async (tx) => {
    await tx.advanceRecovery.create({
      data: {
        advanceId: advance.id,
        companyId: company.id,
        amount: parsed.amount,
        notes: parsed.notes || null,
      },
    })

    const newBalance = balance - requested
    await tx.advance.update({
      where: { id: advance.id },
      data: { status: newBalance <= 0 ? 'PAID' : 'PARTIALLY_RECOVERED' },
    })

    await tx.auditLog.create({
      data: {
        companyId: company.id,
        action: 'CONTRACTOR_ADVANCE_RECOVERED',
        entityType: 'Advance',
        entityId: advance.id,
        oldValueJson: { balance: balance.toFixed(2) },
        newValueJson: { recovered: parsed.amount, balance: newBalance.toFixed(2) },
        changedFields: ['balance'],
        reason: parsed.notes || null,
      },
    })
  })

  revalidatePath(`/contractors/${parsed.contractorId}`)
}
