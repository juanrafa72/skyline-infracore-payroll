/**
 * Importa el histórico de los dos libros de nómina.
 *
 * Principios (docs/EXCEL_MAPPING.md §5):
 *  - IDEMPOTENTE: correrlo dos veces no duplica nada.
 *  - FIEL: se importa lo que dice el Excel. No se corrigen datos en silencio.
 *  - NO DECIDE: no une nombres parecidos, no clasifica personas contra máquinas.
 *    Deja una cola de revisión para que un humano decida.
 *  - NUNCA CREA PAGOS: todo entra como IMPORTED_HISTORICAL.
 *
 * Uso:
 *   npx tsx prisma/import-historical.ts /tmp/historico.json          (simulacro)
 *   npx tsx prisma/import-historical.ts /tmp/historico.json --write  (importa)
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from '../src/lib/db/url'
import { periodOf } from '../src/lib/payroll/period'

const adapter = new PrismaPg({ connectionString: databaseUrl() })
const prisma = new PrismaClient({ adapter })

interface Entry {
  sourceRow: number
  company: string
  operation: string | null
  name: string
  date: string
  dayType: 'FULL_DAY' | 'HALF_DAY' | 'NO_WORK'
  reason: string | null
  additionCategory: string | null
  additionAmount: string | null
  deductionAmount: string | null
  deductionNote: string | null
  expectedTotal: string | null
  rate: string | null
  project: string | null
  customer: string | null
  crew: string | null
  note: string | null
}

interface Payload {
  catalog: {
    workers: Array<{ name: string; rate: string | null; item: string | null; operation: string }>
    projects: Array<{ name: string; customer: string | null; crew: string | null }>
  }
  entries: Entry[]
}

/** Nombres que en los Excel son máquinas, no personas. Verificados uno por uno. */
const EQUIPMENT_NAMES = new Set(
  [
    'CAPSTAN', 'PLOW-RENT', 'COMPRESOR 400CC', 'TORNADO',
    'INTERNACIONAL 2014', 'INTERNACIONAL 2014-1', 'MINI ESCAVADORA (JAIRO MEJIA)',
  ].map((name) => name.toUpperCase()),
)

/** Estados disfrazados de proyecto en los Excel. No son proyectos. */
const NOT_A_PROJECT = new Set(['NO WORK', 'WAITING PROYECT', 'SKYLINE ASSET'])

const OPERATION_CODE: Record<string, string> = {
  Aereo: 'AERIAL',
  Underground: 'UNDERGROUND',
  BlowFiber: 'BLOWFIBER',
  Admin: 'ADMIN',
}

const write = process.argv.includes('--write')
const file = process.argv[2] ?? '/tmp/historico.json'

/** Quita el sufijo que los Excel usan para inventar una tarifa nueva. */
function baseName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[\s-]*(UG|BLOW|N|PLOW|PALERO)\d*$/i, '')
    .replace(/\d+$/, '')
    .trim()
}

function normalizeProject(name: string | null): string | null {
  if (!name) return null
  const upper = name.toUpperCase().trim()
  if (NOT_A_PROJECT.has(upper)) return null
  if (upper === 'TUSCALOOSA') return 'Tuscaloosa_AL'
  if (upper === 'SKYLINE ADMIN') return 'SKYLINE_ADMIN'
  return name.trim()
}

async function main() {
  const raw = readFileSync(file, 'utf-8')
  const payload: Payload = JSON.parse(raw)
  const fileHash = createHash('sha256').update(raw).digest('hex')

  console.log(`\nArchivo: ${file}`)
  console.log(`Días en el archivo: ${payload.entries.length}`)
  console.log(write ? 'MODO: importando\n' : 'MODO: simulacro (agrega --write para importar)\n')

  const companies = await prisma.company.findMany()
  const companyByCode = new Map(companies.map((company) => [company.code, company]))
  if (companyByCode.size === 0) throw new Error('No hay compañías. Correr primero: npm run db:seed')

  // ── Cruce entre compañías: mismo (persona, día) en las dos. Se retienen.
  const seen = new Map<string, string>()
  const crossCompany = new Set<string>()
  for (const entry of payload.entries) {
    const key = `${entry.name.toUpperCase()}|${entry.date}`
    const previous = seen.get(key)
    if (previous && previous !== entry.company) crossCompany.add(key)
    else if (!previous) seen.set(key, entry.company)
  }

  // ── Duplicados internos: mismo (compañía, persona, día) más de una vez.
  const counts = new Map<string, number>()
  for (const entry of payload.entries) {
    const key = `${entry.company}|${entry.name.toUpperCase()}|${entry.date}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const internalDuplicates = [...counts.entries()].filter(([, count]) => count > 1)

  // ── Nombres: se separan máquinas y cuadrillas de las personas.
  const crewNames = new Set(
    payload.catalog.projects
      .map((project) => project.crew?.toUpperCase())
      .filter((crew): crew is string => Boolean(crew) && crew !== 'N/A'),
  )

  const namesByCompany = new Map<string, Set<string>>()
  const firstDate = new Map<string, string>()
  for (const entry of payload.entries) {
    if (!namesByCompany.has(entry.company)) namesByCompany.set(entry.company, new Set())
    namesByCompany.get(entry.company)!.add(entry.name)
    const key = `${entry.company}|${entry.name}`
    const current = firstDate.get(key)
    if (!current || entry.date < current) firstDate.set(key, entry.date)
  }

  const allNames = [...new Set(payload.entries.map((entry) => entry.name))]
  const asEquipment = allNames.filter((name) => EQUIPMENT_NAMES.has(name.toUpperCase()))
  const asCrew = allNames.filter(
    (name) => !EQUIPMENT_NAMES.has(name.toUpperCase()) && crewNames.has(name.toUpperCase()),
  )
  const asWorker = allNames.filter(
    (name) => !EQUIPMENT_NAMES.has(name.toUpperCase()) && !crewNames.has(name.toUpperCase()),
  )

  // Nombres que se parecen: candidatos a ser la misma persona. NO se unen aquí.
  const byBase = new Map<string, string[]>()
  for (const name of asWorker) {
    const base = baseName(name)
    if (!byBase.has(base)) byBase.set(base, [])
    byBase.get(base)!.push(name)
  }
  const toReview = [...byBase.entries()].filter(([, names]) => names.length > 1)

  console.log('── Qué encontró ──')
  console.log(`  personas (provisional):        ${asWorker.length}`)
  console.log(`  cuadrillas:                    ${asCrew.length}   ${asCrew.join(', ')}`)
  console.log(`  máquinas:                      ${asEquipment.length}   ${asEquipment.join(', ')}`)
  console.log(`  grupos de nombres a revisar:   ${toReview.length}`)
  console.log(`  días duplicados entre libros:  ${crossCompany.size}   (se retienen)`)
  console.log(`  duplicados dentro de un libro: ${internalDuplicates.length}   (se retienen)`)

  if (!write) {
    console.log('\nEjemplos de nombres a revisar (posible misma persona):')
    for (const [base, names] of toReview.slice(0, 8)) {
      console.log(`  ${base}: ${names.join('  ·  ')}`)
    }
    console.log('\nSimulacro terminado. Nada se escribió.')
    await prisma.$disconnect()
    return
  }

  // ─────────────────────────────────────────────────────────────
  // Importación
  // ─────────────────────────────────────────────────────────────

  const stats = {
    customers: 0, projects: 0, crews: 0, workers: 0, equipment: 0, rates: 0,
    entries: 0, held: 0, crewDays: 0, equipmentDays: 0, exceptions: 0,
  }

  for (const [code, company] of companyByCode) {
    const batch = await prisma.importBatch.upsert({
      where: { companyId_fileHash_targetEntity: { companyId: company.id, fileHash, targetEntity: 'HISTORICAL' } },
      update: {},
      create: {
        companyId: company.id,
        fileName: file.split('/').pop() ?? file,
        fileHash,
        sourceType: 'EXCEL',
        targetEntity: 'HISTORICAL',
        status: 'IMPORTED',
        rowsRead: payload.entries.filter((entry) => entry.company === code).length,
      },
    })

    const operations = await prisma.operation.findMany({ where: { companyId: company.id } })
    const operationByCode = new Map(operations.map((operation) => [operation.code, operation.id]))

    // Clientes
    const customerNames = new Set(
      payload.entries
        .filter((entry) => entry.company === code && entry.customer)
        .map((entry) => entry.customer!.trim())
        .filter((name) => !NOT_A_PROJECT.has(name.toUpperCase())),
    )
    const customerIds = new Map<string, string>()
    for (const name of customerNames) {
      const customer = await prisma.customer.upsert({
        where: { companyId_name: { companyId: company.id, name } },
        update: {},
        create: { companyId: company.id, name, code: name.slice(0, 20).toUpperCase() },
      })
      customerIds.set(name.toUpperCase(), customer.id)
      stats.customers += 1
    }

    // Proyectos
    const projectIds = new Map<string, string>()
    const projectNames = new Set(
      payload.entries
        .filter((entry) => entry.company === code)
        .map((entry) => normalizeProject(entry.project))
        .filter((name): name is string => Boolean(name)),
    )
    for (const name of projectNames) {
      const source = payload.entries.find(
        (entry) => entry.company === code && normalizeProject(entry.project) === name && entry.customer,
      )
      const project = await prisma.project.upsert({
        where: { companyId_code: { companyId: company.id, code: name.toUpperCase() } },
        update: {},
        create: {
          companyId: company.id,
          code: name.toUpperCase(),
          name,
          customerId: source?.customer ? (customerIds.get(source.customer.trim().toUpperCase()) ?? null) : null,
        },
      })
      projectIds.set(name.toUpperCase(), project.id)
      stats.projects += 1
    }

    // Cuadrillas
    const crewIds = new Map<string, string>()
    const crewsHere = new Set(
      payload.entries
        .filter((entry) => entry.company === code && entry.crew && entry.crew.toUpperCase() !== 'N/A')
        .map((entry) => entry.crew!.trim()),
    )
    for (const name of [...crewsHere, ...asCrew]) {
      const crew = await prisma.crew.upsert({
        where: { companyId_code: { companyId: company.id, code: name.toUpperCase() } },
        update: {},
        create: { companyId: company.id, code: name.toUpperCase(), name },
      })
      crewIds.set(name.toUpperCase(), crew.id)
      stats.crews += 1
    }

    // Máquinas
    for (const name of asEquipment) {
      if (!namesByCompany.get(code)?.has(name)) continue
      await prisma.equipment.upsert({
        where: { companyId_code: { companyId: company.id, code: name.toUpperCase() } },
        update: {},
        create: {
          companyId: company.id,
          code: name.toUpperCase(),
          name,
          kind: name.toUpperCase().includes('2014') ? 'VEHICLE' : 'MACHINE',
          notes: 'Importado del Excel. Su costo diario es costo de equipo, no salario.',
        },
      })
      stats.equipment += 1
    }

    // Personas — una por nombre, tal como está en el Excel. Sin unir nada.
    const workerIds = new Map<string, string>()
    const namesHere = [...(namesByCompany.get(code) ?? [])].filter((name) => asWorker.includes(name))

    for (const name of namesHere) {
      const parts = name.split(/\s+/)
      const worker = await prisma.worker.upsert({
        where: { companyId_code: { companyId: company.id, code: name.toUpperCase().slice(0, 60) } },
        update: {},
        create: {
          companyId: company.id,
          code: name.toUpperCase().slice(0, 60),
          firstName: parts[0] ?? name,
          lastName: parts.slice(1).join(' ') || '—',
          displayName: name,
          personType: 'EMPLOYEE',
          compensationType: 'DAILY_RATE',
          notes: 'Importado del Excel. Identidad sin confirmar.',
        },
      })
      workerIds.set(name, worker.id)
      stats.workers += 1

      await prisma.workerAlias.upsert({
        where: { workerId_alias: { workerId: worker.id, alias: name } },
        update: {},
        create: { workerId: worker.id, alias: name, sourceFile: 'NOMINA 2026', confirmed: false },
      })

      // Tarifa: la del catálogo, vigente desde su primer día registrado.
      const catalogEntry = payload.catalog.workers.find((row) => row.name === name && row.rate)
      const start = firstDate.get(`${code}|${name}`)
      if (catalogEntry?.rate && start) {
        const existing = await prisma.workerRate.findFirst({ where: { workerId: worker.id } })
        if (!existing) {
          await prisma.workerRate.create({
            data: {
              companyId: company.id,
              workerId: worker.id,
              rateType: 'DAILY',
              amount: catalogEntry.rate,
              effectiveFrom: new Date(`${start}T00:00:00Z`),
              operationId: operationByCode.get(catalogEntry.operation) ?? null,
              sourceNote: 'Importada del Excel. La fecha de inicio es el primer día registrado, no la fecha real del acuerdo.',
            },
          })
          stats.rates += 1
        }
      }
    }

    // Días trabajados
    const entriesHere = payload.entries.filter((entry) => entry.company === code)
    const periodCache = new Map<string, string>()

    for (const entry of entriesHere) {
      const crossKey = `${entry.name.toUpperCase()}|${entry.date}`
      const internalKey = `${entry.company}|${entry.name.toUpperCase()}|${entry.date}`

      if (crossCompany.has(crossKey) || (counts.get(internalKey) ?? 0) > 1) {
        stats.held += 1
        continue
      }

      const workerId = workerIds.get(entry.name)
      if (!workerId) {
        // El día pertenece a una cuadrilla o a una máquina, no a una persona.
        // No genera nómina individual, pero SÍ se cuenta: es historia real y
        // no puede desaparecer sin dejar rastro.
        if (EQUIPMENT_NAMES.has(entry.name.toUpperCase())) stats.equipmentDays += 1
        else stats.crewDays += 1
        continue
      }

      const period = periodOf(entry.date, 'WEEKLY')
      const cacheKey = `${code}|${period.year}|${period.periodNumber}`
      let weekId = periodCache.get(cacheKey)
      if (!weekId) {
        const week = await prisma.payrollWeek.upsert({
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
            periodType: 'WEEKLY',
          },
        })
        weekId = week.id
        periodCache.set(cacheKey, weekId)
      }

      await prisma.workEntry.upsert({
        where: {
          companyId_workerId_workDate: {
            companyId: company.id,
            workerId,
            workDate: new Date(`${entry.date}T00:00:00Z`),
          },
        },
        update: {},
        create: {
          companyId: company.id,
          payrollWeekId: weekId,
          workerId,
          workDate: new Date(`${entry.date}T00:00:00Z`),
          dayType: entry.dayType,
          status: entry.reason
            ? (entry.reason as 'RAIN' | 'VACATION' | 'MAINTENANCE' | 'REST')
            : entry.dayType === 'NO_WORK'
              ? 'NO_WORK'
              : 'WORKED',
          projectId: projectIds.get((normalizeProject(entry.project) ?? '').toUpperCase()) ?? null,
          crewId: crewIds.get((entry.crew ?? '').toUpperCase()) ?? null,
          operationId: operationByCode.get(OPERATION_CODE[entry.operation ?? ''] ?? '') ?? null,
          notes: [entry.deductionNote, entry.note].filter(Boolean).join(' · ') || null,
          sourceType: 'IMPORT',
          importRowId: batch.id,
        },
      })
      stats.entries += 1
    }
  }

  // ── Cola de revisión
  const skyline = companyByCode.get('SKYLINE')!
  const openExceptions: Array<{ code: string; title: string; detail: string; level: 'CRITICAL' | 'REVIEW_REQUIRED' }> = []

  for (const [base, names] of toReview) {
    openExceptions.push({
      code: 'DUPLICATE_WORKER',
      level: 'REVIEW_REQUIRED',
      title: `¿Son la misma persona? ${base}`,
      detail: `El Excel tiene estos nombres parecidos: ${names.join(' · ')}. Si son la misma persona hay que unirlos; si no, dejarlos separados. No se unió nada automáticamente.`,
    })
  }
  if (crossCompany.size > 0) {
    openExceptions.push({
      code: 'CROSS_COMPANY_DUPLICATE',
      level: 'CRITICAL',
      title: `${crossCompany.size} días están en los dos libros`,
      detail: 'La misma persona con el mismo día aparece en Skyline y en Infracore. Quedaron retenidos: no se importaron hasta que se decida cuál manda.',
    })
  }
  // Nombres de persona que colisionan con el nombre de una cuadrilla:
  // AMPARO1 (persona, $103) contra AMPARO (cuadrilla). El sufijo los separa en
  // el Excel, pero puede ser la misma cosa. Hay que preguntarlo.
  const collidesWithCrew = asWorker.filter((name) => crewNames.has(baseName(name)))
  if (collidesWithCrew.length > 0) {
    openExceptions.push({
      code: 'REVIEW_ENTITY_TYPE',
      level: 'REVIEW_REQUIRED',
      title: `${collidesWithCrew.length} nombres chocan con el de una cuadrilla`,
      detail: `${collidesWithCrew.join(' · ')} se importaron como personas, pero su nombre base coincide con una cuadrilla. Confirmar si es una persona real o si son días de la cuadrilla mal registrados.`,
    })
  }

  const crewDayNames = allNames.filter((name) => asCrew.includes(name))
  if (crewDayNames.length > 0) {
    openExceptions.push({
      code: 'REVIEW_ENTITY_TYPE',
      level: 'REVIEW_REQUIRED',
      title: `${crewDayNames.length} nombres funcionan a la vez como persona y como cuadrilla`,
      detail: `En el Excel, ${crewDayNames.join(' · ')} aparecen con tarifa propia y también como nombre de cuadrilla. Sus días quedaron registrados como actividad de la cuadrilla, no como nómina de una persona. Si alguno es una persona real hay que separarlo.`,
    })
  }
  if (asEquipment.length > 0) {
    openExceptions.push({
      code: 'REVIEW_ENTITY_TYPE',
      level: 'REVIEW_REQUIRED',
      title: `${asEquipment.length} máquinas tenían tarifa diaria como si fueran empleados`,
      detail: `${asEquipment.join(' · ')} se importaron como equipos. Su costo diario es costo de operación, no salario. Confirmar si alguno se le paga a alguien.`,
    })
  }
  if (internalDuplicates.length > 0) {
    openExceptions.push({
      code: 'DUPLICATE_WORK_ENTRY',
      level: 'CRITICAL',
      title: `${internalDuplicates.length} días repetidos dentro del mismo libro`,
      detail: internalDuplicates.slice(0, 10).map(([key]) => key).join(' · '),
    })
  }

  for (const exception of openExceptions) {
    const already = await prisma.exception.findFirst({
      where: { companyId: skyline.id, code: exception.code, title: exception.title, status: 'OPEN' },
    })
    if (already) continue
    await prisma.exception.create({
      data: {
        companyId: skyline.id,
        code: exception.code,
        level: exception.level,
        entityType: 'ImportBatch',
        title: exception.title,
        detail: exception.detail,
      },
    })
    stats.exceptions += 1
  }

  console.log('\n── Importado ──')
  for (const [key, value] of Object.entries(stats)) console.log(`  ${key.padEnd(12)} ${value}`)
  const accounted = stats.entries + stats.held + stats.crewDays + stats.equipmentDays
  console.log(`\n  ── control ──`)
  console.log(`  días en el archivo:  ${payload.entries.length}`)
  console.log(`  días contabilizados: ${accounted}`)
  if (accounted !== payload.entries.length) {
    console.log(`  ⚠️  DIFERENCIA SIN EXPLICAR: ${payload.entries.length - accounted}`)
  } else {
    console.log('  ✓ cuadra: ningún día se perdió')
  }
  console.log('\nNada quedó marcado como pagado. Los duplicados quedaron retenidos.')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
