/**
 * Completa la operación, el proyecto y la cuadrilla en los días que se
 * capturaron sin ellos.
 *
 * Un día sin operación no encuentra una tarifa amarrada a una operación, y la
 * persona aparece "sin tarifa" teniéndola. Se toma el dato por defecto de cada
 * persona; los días que ya lo traen no se tocan.
 *
 * Uso:  npx tsx scripts/backfill-entry-defaults.mts [--write]
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from '../src/lib/db/url'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) })
const write = process.argv.includes('--write')


/*
 * Paso previo: si una persona no tiene operación asignada pero SÍ tiene una
 * sola tarifa amarrada a una operación, esa es su operación. No hay nada que
 * adivinar. Si tiene varias, se deja para que alguien decida.
 */
const sinOperacion = await prisma.worker.findMany({
  where: { defaultOperationId: null },
  include: { rates: { where: { active: true }, select: { operationId: true } } },
})

let asignadas = 0
for (const worker of sinOperacion) {
  const operaciones = [...new Set(worker.rates.map((r) => r.operationId).filter(Boolean))]
  if (operaciones.length !== 1) continue
  asignadas += 1
  if (write) {
    await prisma.worker.update({
      where: { id: worker.id },
      data: { defaultOperationId: operaciones[0] },
    })
  }
}
console.log(`Personas a las que se les puede deducir la operación: ${asignadas}`)

const entries = await prisma.workEntry.findMany({
  where: { operationId: null },
  include: {
    worker: {
      select: { displayName: true, defaultOperationId: true, defaultProjectId: true, defaultCrewId: true },
    },
  },
})

const fixable = entries.filter((entry) => entry.worker.defaultOperationId !== null)

console.log(`Días sin operación: ${entries.length}`)
console.log(`Se pueden completar: ${fixable.length}`)
console.log(`Sin arreglo (la persona tampoco tiene operación): ${entries.length - fixable.length}`)

if (!write) {
  console.log('\nSimulacro. Agrega --write para aplicar.')
  await prisma.$disconnect()
  process.exit(0)
}

let done = 0
for (const entry of fixable) {
  await prisma.workEntry.update({
    where: { id: entry.id },
    data: {
      operationId: entry.worker.defaultOperationId,
      projectId: entry.projectId ?? entry.worker.defaultProjectId,
      crewId: entry.crewId ?? entry.worker.defaultCrewId,
    },
  })
  done += 1
}

console.log(`\n${done} día(s) completados.`)
await prisma.$disconnect()
