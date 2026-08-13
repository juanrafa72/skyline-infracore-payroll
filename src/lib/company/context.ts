import { cookies } from 'next/headers'
import { prisma } from '@/lib/db/client'

const COOKIE = 'active_company'

export interface ActiveCompany {
  id: string
  code: string
  legalName: string
  displayName: string
}

/**
 * Compañía activa de la sesión.
 *
 * TEMPORAL: hoy vive en una cookie porque todavía no existe autenticación (M3).
 * Cuando entre Auth.js pasará a la sesión del servidor y el cambio exigirá el
 * permiso `company:switch` y quedará auditado (docs/ARCHITECTURE.md §5).
 */
export async function getActiveCompany(): Promise<ActiveCompany> {
  const store = await cookies()
  const requested = store.get(COOKIE)?.value

  const company = requested
    ? await prisma.company.findUnique({ where: { id: requested } })
    : null

  if (company) return company

  const fallback = await prisma.company.findFirst({ orderBy: { code: 'asc' } })
  if (!fallback) {
    throw new Error('No hay compañías configuradas. Ejecutar: npm run db:seed')
  }
  return fallback
}

export async function listCompanies(): Promise<ActiveCompany[]> {
  return prisma.company.findMany({
    where: { active: true },
    orderBy: { displayName: 'asc' },
  })
}

export const ACTIVE_COMPANY_COOKIE = COOKIE
