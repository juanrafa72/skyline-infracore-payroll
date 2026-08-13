/** Conteo rápido de lo que hay en la base. Uso: npx tsx scripts/count.mts */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from '../src/lib/db/url'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) })

const [workers, entries, rates, crews, projects, customers, equipment, exceptions, weeks] =
  await Promise.all([
    prisma.worker.count(), prisma.workEntry.count(), prisma.workerRate.count(),
    prisma.crew.count(), prisma.project.count(), prisma.customer.count(),
    prisma.equipment.count(), prisma.exception.count({ where: { status: 'OPEN' } }),
    prisma.payrollWeek.count(),
  ])

console.log(
  `trabajadores ${workers} · días ${entries} · tarifas ${rates} · cuadrillas ${crews} · ` +
    `proyectos ${projects} · clientes ${customers} · equipos ${equipment} · ` +
    `semanas ${weeks} · revisiones abiertas ${exceptions}`,
)
await prisma.$disconnect()
