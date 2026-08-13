import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from './url'

/**
 * Cliente Prisma. En desarrollo se reutiliza entre recargas para no abrir
 * conexiones de más.
 *
 * IMPORTANTE: este cliente NO se usa directamente para datos de negocio.
 * Todo acceso transaccional debe pasar por el scope de compañía
 * (docs/ARCHITECTURE.md §5). Los catálogos globales (roles, permisos) sí.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl() })
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
