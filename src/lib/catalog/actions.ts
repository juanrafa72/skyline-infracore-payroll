'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'

const nameSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
})

export async function createCustomer(formData: FormData) {
  const company = await getActiveCompany()
  const parsed = nameSchema
    .extend({ earlyPaymentDiscountPct: z.string().trim().optional() })
    .parse(Object.fromEntries(formData))

  await prisma.customer.create({
    data: {
      companyId: company.id,
      name: parsed.name,
      code: parsed.code,
      earlyPaymentDiscountPct: parsed.earlyPaymentDiscountPct || null,
    },
  })
  revalidatePath('/customers')
}

export async function createProject(formData: FormData) {
  const company = await getActiveCompany()
  const parsed = nameSchema
    .extend({
      customerId: z.string().trim().optional(),
      operationId: z.string().trim().optional(),
      location: z.string().trim().optional(),
    })
    .parse(Object.fromEntries(formData))

  await prisma.project.create({
    data: {
      companyId: company.id,
      name: parsed.name,
      code: parsed.code,
      customerId: parsed.customerId || null,
      operationId: parsed.operationId || null,
      location: parsed.location || null,
    },
  })
  revalidatePath('/projects')
}

export async function createCrew(formData: FormData) {
  const company = await getActiveCompany()
  const parsed = nameSchema
    .extend({ operationId: z.string().trim().optional(), projectId: z.string().trim().optional() })
    .parse(Object.fromEntries(formData))

  await prisma.crew.create({
    data: {
      companyId: company.id,
      name: parsed.name,
      code: parsed.code,
      operationId: parsed.operationId || null,
      projectId: parsed.projectId || null,
    },
  })
  revalidatePath('/crews')
}
