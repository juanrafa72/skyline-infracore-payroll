import 'dotenv/config'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from '@/lib/db/url'
import { toggleEquipment, toggleWorker } from '@/lib/catalog/availability'
import type { CurrentUser } from '@/lib/auth/rbac'

/**
 * Sacar de las listas NO puede borrar nada.
 *
 * El negocio lo pidió por el caso de JHON $100 / JHON1 $130: la ficha vieja
 * estorba al escoger, pero sus pagos ya hechos no se pueden perder.
 */

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) })
const PREFIX = 'test-availability'

let user: CurrentUser
let workerId: string
let equipmentId: string

beforeAll(async () => {
  await limpiar()

  await prisma.company.create({
    data: { id: PREFIX, code: 'TESTAV', legalName: 'Test', displayName: 'Test' },
  })
  const admin = await prisma.user.create({
    data: { id: PREFIX, email: `${PREFIX}@local`, name: 'Test', updatedAt: new Date() },
  })

  user = {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    companyId: PREFIX,
    companyCode: 'TESTAV',
    companyName: 'Test',
    roleCodes: [],
    permissions: new Set(['worker:manage', 'equipment:manage']),
    availableCompanies: [],
  }

  const worker = await prisma.worker.create({
    data: {
      companyId: PREFIX,
      code: 'AV1',
      firstName: 'Jhon',
      lastName: 'Viejo',
      displayName: 'JHON',
      updatedAt: new Date(),
    },
  })
  workerId = worker.id

  const week = await prisma.payrollWeek.create({
    data: {
      companyId: PREFIX,
      year: 2026,
      weekNumber: 40,
      startDate: new Date('2026-09-27T00:00:00Z'),
      endDate: new Date('2026-10-03T00:00:00Z'),
      label: 'Semana 40',
      periodType: 'WEEKLY',
    },
  })

  // Su historia: días trabajados y una nómina ya pagada.
  await prisma.workEntry.createMany({
    data: ['2026-09-28', '2026-09-29'].map((d) => ({
      companyId: PREFIX,
      payrollWeekId: week.id,
      workerId: worker.id,
      workDate: new Date(`${d}T00:00:00Z`),
      dayType: 'FULL_DAY' as const,
    })),
  })
  await prisma.workerPayroll.create({
    data: {
      companyId: PREFIX,
      payrollWeekId: week.id,
      workerId: worker.id,
      status: 'PAID',
      daysFull: 2,
      basePay: '200.00',
      grossPay: '200.00',
      netPay: '200.00',
    },
  })

  const machine = await prisma.equipment.create({
    data: { companyId: PREFIX, code: 'AVE1', name: 'Camion viejo', ownership: 'OWNED' },
  })
  equipmentId = machine.id
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

async function limpiar() {
  /*
   * El audit log es append-only por trigger (BR-140) y la nómina pagada es
   * inmutable: para limpiar los datos de prueba hay que apagar los candados un
   * momento. Es un privilegio que la aplicación nunca tiene — si este cleanup
   * empieza a fallar, casi siempre es un trigger nuevo que falta desactivar.
   */
  await prisma.$executeRawUnsafe('ALTER TABLE worker_payroll DISABLE TRIGGER USER')
  await prisma.$executeRawUnsafe('ALTER TABLE audit_log DISABLE TRIGGER USER')
  try {
    await prisma.auditLog.deleteMany({ where: { companyId: PREFIX } })
    await prisma.workerPayroll.deleteMany({ where: { companyId: PREFIX } })
    await prisma.workEntry.deleteMany({ where: { companyId: PREFIX } })
    await prisma.equipment.deleteMany({ where: { companyId: PREFIX } })
    await prisma.worker.deleteMany({ where: { companyId: PREFIX } })
    await prisma.payrollWeek.deleteMany({ where: { companyId: PREFIX } })
    await prisma.user.deleteMany({ where: { id: PREFIX } })
    await prisma.company.deleteMany({ where: { id: PREFIX } })
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE audit_log ENABLE TRIGGER USER')
    await prisma.$executeRawUnsafe('ALTER TABLE worker_payroll ENABLE TRIGGER USER')
  }
}

describe('sacar a alguien de las listas', () => {
  it('lo saca de las listas', async () => {
    const r = await toggleWorker(user, workerId)
    expect(r.ok).toBe(true)
    expect(
      (await prisma.worker.findUniqueOrThrow({ where: { id: workerId } })).status,
    ).toBe('INACTIVE')
  })

  it('NO borra sus días ni su nómina pagada', async () => {
    // Es lo que hace seguro el botón: la ficha estorba, la historia no se toca.
    expect(await prisma.workEntry.count({ where: { workerId } })).toBe(2)
    expect(await prisma.workerPayroll.count({ where: { workerId } })).toBe(1)
  })

  it('deja de aparecer en la lista de quién puede trabajar', async () => {
    const enListas = await prisma.worker.count({
      where: { companyId: PREFIX, status: 'ACTIVE' },
    })
    expect(enListas).toBe(0)
  })

  it('queda rastro de quién lo sacó', async () => {
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: workerId, action: 'WORKER_DEACTIVATED' },
    })
    expect(audit).not.toBeNull()
    expect(audit!.userId).toBe(user.id)
  })

  it('se puede devolver', async () => {
    const r = await toggleWorker(user, workerId)
    expect(r.ok).toBe(true)
    expect(
      (await prisma.worker.findUniqueOrThrow({ where: { id: workerId } })).status,
    ).toBe('ACTIVE')
  })
})

describe('lo que NO se puede sacar', () => {
  it('alguien con una nómina a medio pagar', async () => {
    // Quitarlo lo dejaría a medio camino: quien aprueba lo vería sin poder
    // encontrarlo en ninguna parte.
    // En otra semana: solo puede haber una nómina por persona y semana.
    const otraSemana = await prisma.payrollWeek.create({
      data: {
        companyId: PREFIX,
        year: 2026,
        weekNumber: 41,
        startDate: new Date('2026-10-04T00:00:00Z'),
        endDate: new Date('2026-10-10T00:00:00Z'),
        label: 'Semana 41',
        periodType: 'WEEKLY',
      },
    })
    const pendiente = await prisma.workerPayroll.create({
      data: {
        companyId: PREFIX,
        payrollWeekId: otraSemana.id,
        workerId,
        status: 'PENDING_APPROVAL',
        daysFull: 1,
        basePay: '100.00',
        grossPay: '100.00',
        netPay: '100.00',
      },
    })

    const r = await toggleWorker(user, workerId)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('sin terminar de pagar')
    expect(
      (await prisma.worker.findUniqueOrThrow({ where: { id: workerId } })).status,
    ).toBe('ACTIVE')

    await prisma.workerPayroll.delete({ where: { id: pendiente.id } })
    await prisma.payrollWeek.delete({ where: { id: otraSemana.id } })
  })

  it('alguien de otra compañía', async () => {
    const otra = await prisma.worker.findFirst({ where: { companyId: { not: PREFIX } } })
    if (!otra) return
    const r = await toggleWorker(user, otra.id)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('no existe en esta compañía')
  })
})

describe('equipos', () => {
  it('se retiran y vuelven igual, sin perder su ficha', async () => {
    expect((await toggleEquipment(user, equipmentId)).ok).toBe(true)
    expect(
      (await prisma.equipment.findUniqueOrThrow({ where: { id: equipmentId } })).status,
    ).toBe('RETIRED')

    expect((await toggleEquipment(user, equipmentId)).ok).toBe(true)
    expect(
      (await prisma.equipment.findUniqueOrThrow({ where: { id: equipmentId } })).status,
    ).toBe('ACTIVE')
  })
})
