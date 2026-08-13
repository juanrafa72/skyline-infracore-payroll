import { prisma } from '@/lib/db/client'
import { requireUser } from '@/lib/auth/rbac'
import type { PayPeriodType } from '@/lib/payroll/period'

export interface ActiveCompany {
  id: string
  code: string
  legalName: string
  displayName: string
  defaultPayPeriod: PayPeriodType
  biweeklyAnchor: Date | null
}

/**
 * Compañía activa de la sesión.
 *
 * Sale de la sesión del servidor, no de un valor que mande el navegador: así
 * nadie puede ver otra compañía cambiando una cookie o un parámetro.
 */
export async function getActiveCompany(): Promise<ActiveCompany> {
  const user = await requireUser()
  const company = await prisma.company.findUnique({ where: { id: user.companyId } })
  if (!company) throw new Error('La compañía de la sesión ya no existe.')
  return company
}

export async function listCompanies(): Promise<ActiveCompany[]> {
  const user = await requireUser()
  return prisma.company.findMany({
    where: { id: { in: user.availableCompanies.map((company) => company.id) } },
    orderBy: { displayName: 'asc' },
  })
}
