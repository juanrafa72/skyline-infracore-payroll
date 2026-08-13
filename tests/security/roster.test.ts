/**
 * Pruebas de la lista de personas de un período, contra la base real.
 *
 * Existen porque los dos errores que reportó el negocio —no avanzar al paso 2 y
 * reventar al quitar— pasaron todas las revisiones anteriores: compilaban, y el
 * chequeo de pantallas solo miraba que abrieran, no que los botones hicieran
 * algo. Estas pruebas ejercitan la operación de verdad.
 */
import 'dotenv/config'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from '@/lib/db/url'
import { currentRoster, removeFromRoster, setRoster } from '@/lib/payroll/roster'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) })

const COMPANY = 'test-roster-company'
const WEEK = 'test-roster-week'
const PEOPLE = ['test-roster-w1', 'test-roster-w2', 'test-roster-w3']

async function cleanup() {
  await prisma.workEntry.deleteMany({ where: { companyId: COMPANY } })
  await prisma.payrollWeekMember.deleteMany({ where: { companyId: COMPANY } })
  await prisma.payrollWeek.deleteMany({ where: { companyId: COMPANY } })
  await prisma.worker.deleteMany({ where: { companyId: COMPANY } })
  await prisma.company.deleteMany({ where: { id: COMPANY } })
}

beforeEach(async () => {
  await cleanup()
  await prisma.company.create({
    data: { id: COMPANY, code: 'TEST_ROSTER', legalName: 'T', displayName: 'T' },
  })
  await prisma.payrollWeek.create({
    data: {
      id: WEEK,
      companyId: COMPANY,
      year: 2026,
      weekNumber: 99,
      startDate: new Date('2026-07-19T00:00:00Z'),
      endDate: new Date('2026-07-25T00:00:00Z'),
      label: 'Semana 99',
    },
  })
  for (const [index, id] of PEOPLE.entries()) {
    await prisma.worker.create({
      data: {
        id,
        companyId: COMPANY,
        code: `W${index}`,
        firstName: `P${index}`,
        lastName: 'X',
        displayName: `Persona ${index}`,
      },
    })
  }
})

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function markDay(workerId: string) {
  await prisma.workEntry.create({
    data: {
      companyId: COMPANY,
      payrollWeekId: WEEK,
      workerId,
      workDate: new Date('2026-07-20T00:00:00Z'),
      dayType: 'FULL_DAY',
    },
  })
}

describe('elegir personas para la semana', () => {
  it('agrega a las marcadas', async () => {
    const result = await setRoster(COMPANY, WEEK, [PEOPLE[0]!, PEOPLE[1]!])
    expect(result.ok).toBe(true)
    expect(await currentRoster(COMPANY, WEEK)).toHaveLength(2)
  })

  it('agregar de a uno va sumando, no reemplazando', async () => {
    await setRoster(COMPANY, WEEK, [PEOPLE[0]!])
    await setRoster(COMPANY, WEEK, [PEOPLE[1]!])
    await setRoster(COMPANY, WEEK, [PEOPLE[2]!])
    expect(await currentRoster(COMPANY, WEEK)).toHaveLength(3)
  })

  it('NO bloquea cuando alguien más ya tiene días — el error reportado', async () => {
    // La semana ya trae gente con días (histórico importado).
    await markDay(PEOPLE[2]!)

    // Se eligen otras dos personas, sin marcar a la que ya tenía días.
    const result = await setRoster(COMPANY, WEEK, [PEOPLE[0]!, PEOPLE[1]!])

    expect(result.ok).toBe(true)
    // Las tres quedan: las dos elegidas más la que ya tenía días.
    expect(await currentRoster(COMPANY, WEEK)).toHaveLength(3)
  })

  it('quien tiene días se conserva aunque no se marque', async () => {
    await markDay(PEOPLE[0]!)
    await setRoster(COMPANY, WEEK, [PEOPLE[1]!])
    const roster = await currentRoster(COMPANY, WEEK)
    expect(roster).toContain(PEOPLE[0]!)
    expect(roster).toContain(PEOPLE[1]!)
  })

  it('repetir la misma selección no duplica', async () => {
    await setRoster(COMPANY, WEEK, [PEOPLE[0]!])
    await setRoster(COMPANY, WEEK, [PEOPLE[0]!])
    expect(await currentRoster(COMPANY, WEEK)).toHaveLength(1)
  })

  it('avisa si no se marcó a nadie', async () => {
    const result = await setRoster(COMPANY, WEEK, [])
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/no marcaste/i)
  })

  it('no toca una semana cerrada', async () => {
    await prisma.payrollWeek.update({ where: { id: WEEK }, data: { status: 'CLOSED' } })
    const result = await setRoster(COMPANY, WEEK, [PEOPLE[0]!])
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/cerrada/i)
  })

  it('no acepta un período de otra compañía', async () => {
    const result = await setRoster('otra-compania', WEEK, [PEOPLE[0]!])
    expect(result.ok).toBe(false)
  })
})

describe('quitar a alguien de la semana', () => {
  it('quita a quien no tiene días', async () => {
    await setRoster(COMPANY, WEEK, [PEOPLE[0]!, PEOPLE[1]!])
    const result = await removeFromRoster(COMPANY, WEEK, PEOPLE[0]!)
    expect(result.ok).toBe(true)
    expect(await currentRoster(COMPANY, WEEK)).toEqual([PEOPLE[1]!])
  })

  it('NO revienta cuando tiene días: devuelve un aviso — el error reportado', async () => {
    await setRoster(COMPANY, WEEK, [PEOPLE[0]!])
    await markDay(PEOPLE[0]!)

    const result = await removeFromRoster(COMPANY, WEEK, PEOPLE[0]!)

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Persona 0')
    expect(result.message).toMatch(/día/i)
    // Y sobre todo: la persona sigue ahí, con sus días intactos.
    expect(await currentRoster(COMPANY, WEEK)).toContain(PEOPLE[0]!)
    expect(
      await prisma.workEntry.count({ where: { companyId: COMPANY, workerId: PEOPLE[0]! } }),
    ).toBe(1)
  })

  it('quitar a alguien que nunca estuvo no rompe nada', async () => {
    const result = await removeFromRoster(COMPANY, WEEK, PEOPLE[2]!)
    expect(result.ok).toBe(true)
  })

  it('se puede volver a agregar a quien se quitó', async () => {
    await setRoster(COMPANY, WEEK, [PEOPLE[0]!])
    await removeFromRoster(COMPANY, WEEK, PEOPLE[0]!)
    expect(await currentRoster(COMPANY, WEEK)).toHaveLength(0)

    await setRoster(COMPANY, WEEK, [PEOPLE[0]!])
    expect(await currentRoster(COMPANY, WEEK)).toEqual([PEOPLE[0]!])
  })
})
