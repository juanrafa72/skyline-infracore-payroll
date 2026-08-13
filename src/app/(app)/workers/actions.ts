'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'

const workerSchema = z.object({
  firstName: z.string().trim().min(1, 'El nombre es obligatorio'),
  lastName: z.string().trim().min(1, 'El apellido es obligatorio'),
  code: z.string().trim().min(1),
  personType: z.enum(['EMPLOYEE', 'CONTRACTOR_MEMBER', 'ADMINISTRATIVE', 'SUBCONTRACTOR']),
  compensationType: z.enum(['DAILY_RATE', 'HOURLY', 'FIXED_WEEKLY', 'PRODUCTION', 'PIECE_RATE', 'PERCENTAGE', 'CONTRACTOR_SETTLEMENT', 'MANUAL']),
  operationId: z.string().trim().optional(),
  crewId: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  isOnFormalPayroll: z.string().optional(),
})

export async function createWorker(formData: FormData) {
  const company = await getActiveCompany()
  const parsed = workerSchema.parse(Object.fromEntries(formData))

  const worker = await prisma.worker.create({
    data: {
      companyId: company.id,
      code: parsed.code,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      displayName: `${parsed.firstName} ${parsed.lastName}`.trim(),
      personType: parsed.personType,
      compensationType: parsed.compensationType,
      isOnFormalPayroll: parsed.isOnFormalPayroll === 'on',
      defaultOperationId: parsed.operationId || null,
      defaultCrewId: parsed.crewId || null,
      phone: parsed.phone || null,
    },
  })

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      action: 'WORKER_CREATED',
      entityType: 'Worker',
      entityId: worker.id,
      newValueJson: { displayName: worker.displayName, code: worker.code },
      changedFields: ['displayName', 'code'],
    },
  })

  revalidatePath('/workers')
  redirect(`/workers/${worker.id}`)
}

const rateSchema = z.object({
  workerId: z.string().min(1),
  rateType: z.enum(['DAILY', 'HOURLY', 'WEEKLY']),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Monto con máximo 2 decimales'),
  shift: z.enum(['ANY', 'DAY', 'NIGHT']),
  projectId: z.string().trim().optional(),
  effectiveFrom: z.string().min(1),
  effectiveTo: z.string().optional(),
  sourceNote: z.string().trim().optional(),
})

export async function createRate(formData: FormData) {
  const company = await getActiveCompany()
  const parsed = rateSchema.parse(Object.fromEntries(formData))

  // La base rechaza rangos solapados (BR-035). Si ocurre, el error sube tal cual:
  // es preferible fallar visiblemente a guardar dos tarifas contradictorias.
  const rate = await prisma.workerRate.create({
    data: {
      companyId: company.id,
      workerId: parsed.workerId,
      rateType: parsed.rateType,
      amount: parsed.amount,
      shift: parsed.shift,
      projectId: parsed.projectId || null,
      effectiveFrom: new Date(`${parsed.effectiveFrom}T00:00:00Z`),
      effectiveTo: parsed.effectiveTo ? new Date(`${parsed.effectiveTo}T00:00:00Z`) : null,
      sourceNote: parsed.sourceNote || null,
    },
  })

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      action: 'RATE_CREATED',
      entityType: 'WorkerRate',
      entityId: rate.id,
      newValueJson: { amount: parsed.amount, from: parsed.effectiveFrom, shift: parsed.shift },
      changedFields: ['amount', 'effectiveFrom'],
      reason: parsed.sourceNote || null,
    },
  })

  revalidatePath(`/workers/${parsed.workerId}`)
}
