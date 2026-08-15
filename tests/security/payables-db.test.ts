/**
 * Pagables de cuadrilla y equipo contra la base real: el motor genérico aplica
 * las MISMAS reglas que a las personas (BR-180, segregación, errores críticos)
 * más sus puertas propias (contratista, proveedor), y los candados de la base
 * congelan lo pagado.
 */
import 'dotenv/config'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from '@/lib/db/url'
import type { CurrentUser } from '@/lib/auth/rbac'
import {
  applyPayableTransition,
  invalidateCrewIfStale,
} from '@/lib/payroll/workflow/payables'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) })

const COMPANY = 'test-payables-company'
const WEEK = 'test-payables-week'
const CREW = 'test-payables-crew'
const CONTRACTOR = 'test-payables-contractor'
const RECIPIENT = 'test-payables-recipient'
const EQUIPMENT = 'test-payables-equipment'

const PERMISSIONS = new Set([
  'payroll:submit',
  'payroll:approve',
  'payroll:reject',
  'payroll:return',
  'payment:execute',
])

function actor(id: string): CurrentUser {
  return {
    id,
    name: id,
    email: `${id}@test`,
    companyId: COMPANY,
    companyCode: 'TP',
    companyName: 'TP',
    roleCodes: [],
    permissions: PERMISSIONS,
    availableCompanies: [],
  }
}

const leo = actor('test-payables-leo')
const rafael = actor('test-payables-rafael')

async function cleanup() {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE crew_payroll DISABLE TRIGGER crew_payroll_immutable',
  )
  await prisma.$executeRawUnsafe(
    'ALTER TABLE equipment_payroll DISABLE TRIGGER equipment_payroll_immutable',
  )
  await prisma.$executeRawUnsafe('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_delete')
  try {
    // Borrar los usuarios de prueba exige borrar antes su rastro de auditoría
    // (el FK haría un UPDATE sobre audit_log, que es append-only). Es el mismo
    // privilegio momentáneo que usa flow-check; la aplicación jamás lo tiene.
    await prisma.auditLog.deleteMany({ where: { companyId: COMPANY } })
    await prisma.exception.deleteMany({ where: { companyId: COMPANY } })
    await prisma.production.deleteMany({ where: { companyId: COMPANY } })
    await prisma.crewPayroll.deleteMany({ where: { companyId: COMPANY } })
    await prisma.equipmentPayroll.deleteMany({ where: { companyId: COMPANY } })
    await prisma.equipmentEntry.deleteMany({ where: { companyId: COMPANY } })
    // El registro de auditoría NO se borra: es append-only a propósito.
    await prisma.crewPricing.deleteMany({ where: { companyId: COMPANY } })
    await prisma.crew.deleteMany({ where: { companyId: COMPANY } })
    // (la auditoría de la compañía de prueba ya se borró arriba)
    await prisma.contractor.deleteMany({ where: { companyId: COMPANY } })
    await prisma.equipment.deleteMany({ where: { companyId: COMPANY } })
    await prisma.vendor.deleteMany({ where: { companyId: COMPANY } })
    await prisma.paymentRecipient.deleteMany({ where: { companyId: COMPANY } })
    await prisma.payrollWeek.deleteMany({ where: { companyId: COMPANY } })
    await prisma.company.deleteMany({ where: { id: COMPANY } })
    await prisma.user.deleteMany({ where: { id: { in: [leo.id, rafael.id] } } })
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE crew_payroll ENABLE TRIGGER crew_payroll_immutable',
    )
    await prisma.$executeRawUnsafe(
      'ALTER TABLE equipment_payroll ENABLE TRIGGER equipment_payroll_immutable',
    )
    await prisma.$executeRawUnsafe('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_delete')
  }
}

beforeEach(async () => {
  await cleanup()
  await prisma.company.create({
    data: { id: COMPANY, code: 'TEST_PAYABLES', legalName: 'TP', displayName: 'TP' },
  })
  // La auditoría exige que el usuario exista (llave foránea): actores reales.
  for (const user of [leo, rafael]) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name } })
  }
  await prisma.payrollWeek.create({
    data: {
      id: WEEK,
      companyId: COMPANY,
      year: 2026,
      weekNumber: 98,
      startDate: new Date('2026-07-19T00:00:00Z'),
      endDate: new Date('2026-07-25T00:00:00Z'),
      label: 'Semana 98',
    },
  })
  await prisma.contractor.create({
    data: { id: CONTRACTOR, companyId: COMPANY, name: 'Contratista Prueba' },
  })
  await prisma.crew.create({
    data: { id: CREW, companyId: COMPANY, code: 'CR1', name: 'Cuadrilla Prueba' },
  })
  await prisma.paymentRecipient.create({
    data: {
      id: RECIPIENT,
      companyId: COMPANY,
      name: 'Receptora Prueba',
      normalizedName: 'receptora prueba payables',
    },
  })
  await prisma.equipment.create({
    data: {
      id: EQUIPMENT,
      companyId: COMPANY,
      code: 'EQ1',
      name: 'Camion Prueba',
      ownership: 'RENTED',
      dailyCost: '450.00',
    },
  })
})

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function createCrewPayroll(overrides: Record<string, unknown> = {}) {
  return prisma.crewPayroll.create({
    data: {
      companyId: COMPANY,
      payrollWeekId: WEEK,
      crewId: CREW,
      crewNameSnapshot: 'Cuadrilla Prueba',
      productionTotal: '800.00',
      productionCount: 2,
      status: 'PREPARED',
      ...overrides,
    },
  })
}

describe('flujo del pagable de cuadrilla', () => {
  it('sin empresa receptora NO se aprueba (BR-180, mismo choke point)', async () => {
    const payroll = await createCrewPayroll({ contractorId: CONTRACTOR })
    await applyPayableTransition(leo, 'CREW', [payroll.id], 'SUBMIT')

    const result = await applyPayableTransition(rafael, 'CREW', [payroll.id], 'APPROVE')
    expect(result.moved).toBe(0)
    expect(result.skipped[0]?.reason).toContain('empresa receptora')
  })

  it('sin contratista NO se aprueba: no hay a quién pagarle', async () => {
    const payroll = await createCrewPayroll({ paymentRecipientId: RECIPIENT })
    await applyPayableTransition(leo, 'CREW', [payroll.id], 'SUBMIT')

    const result = await applyPayableTransition(rafael, 'CREW', [payroll.id], 'APPROVE')
    expect(result.moved).toBe(0)
    expect(result.skipped[0]?.reason).toContain('contratista')
  })

  it('quien envía no puede aprobar lo suyo', async () => {
    const payroll = await createCrewPayroll({
      contractorId: CONTRACTOR,
      paymentRecipientId: RECIPIENT,
    })
    await applyPayableTransition(leo, 'CREW', [payroll.id], 'SUBMIT')

    const self = await applyPayableTransition(leo, 'CREW', [payroll.id], 'APPROVE')
    expect(self.moved).toBe(0)
    expect(self.skipped[0]?.reason).toContain('otra persona')
  })

  it('con receptora y contratista, otra persona aprueba y la huella queda congelada', async () => {
    const payroll = await createCrewPayroll({
      contractorId: CONTRACTOR,
      paymentRecipientId: RECIPIENT,
    })
    await applyPayableTransition(leo, 'CREW', [payroll.id], 'SUBMIT')

    const result = await applyPayableTransition(rafael, 'CREW', [payroll.id], 'APPROVE')
    expect(result.moved).toBe(1)

    const approved = await prisma.crewPayroll.findUniqueOrThrow({ where: { id: payroll.id } })
    expect(approved.status).toBe('APPROVED')
    expect(approved.approvedById).toBe(rafael.id)
    expect(approved.calculationHash).not.toBeNull()
    expect(approved.selfApproved).toBe(false)
  })

  it('si la producción cambia después de aprobar, la aprobación se cae sola', async () => {
    const payroll = await createCrewPayroll({
      contractorId: CONTRACTOR,
      paymentRecipientId: RECIPIENT,
    })
    await applyPayableTransition(leo, 'CREW', [payroll.id], 'SUBMIT')
    await applyPayableTransition(rafael, 'CREW', [payroll.id], 'APPROVE')

    await prisma.production.create({
      data: {
        companyId: COMPANY,
        payrollWeekId: WEEK,
        crewId: CREW,
        productionDate: new Date('2026-07-22T00:00:00Z'),
        unitCode: 'FIBER',
        unitLabel: 'Fibra',
        quantity: '100.00',
        appliedPrice: '0.5',
        amount: '50.00',
      },
    })

    const invalidated = await invalidateCrewIfStale(payroll.id)
    expect(invalidated).toBe(true)

    const after = await prisma.crewPayroll.findUniqueOrThrow({ where: { id: payroll.id } })
    expect(after.status).toBe('PENDING_APPROVAL')
    expect(after.approvedById).toBeNull()

    const exception = await prisma.exception.findFirst({
      where: { companyId: COMPANY, entityType: 'CrewPayroll', entityId: payroll.id },
    })
    expect(exception?.level).toBe('CRITICAL')
  })
})

describe('flujo del pagable de equipo', () => {
  it('sin proveedor NO se aprueba: un equipo jamás recibe pagos (BR-121)', async () => {
    const payroll = await prisma.equipmentPayroll.create({
      data: {
        companyId: COMPANY,
        payrollWeekId: WEEK,
        equipmentId: EQUIPMENT,
        equipmentNameSnapshot: 'Camion Prueba',
        daysTotal: 3,
        appliedDailyCost: '450.00',
        totalAmount: '1350.00',
        status: 'PREPARED',
        paymentRecipientId: RECIPIENT,
      },
    })
    await applyPayableTransition(leo, 'EQUIPMENT', [payroll.id], 'SUBMIT')

    const result = await applyPayableTransition(rafael, 'EQUIPMENT', [payroll.id], 'APPROVE')
    expect(result.moved).toBe(0)
    expect(result.skipped[0]?.reason).toContain('proveedor')
  })
})

describe('candados de la base', () => {
  it('una liquidación de cuadrilla pagada no se modifica ni se borra', async () => {
    const payroll = await createCrewPayroll({
      contractorId: CONTRACTOR,
      paymentRecipientId: RECIPIENT,
      status: 'PAID',
    })

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE crew_payroll SET "productionTotal" = '999.00' WHERE id = $1`,
        payroll.id,
      ),
    ).rejects.toThrow(/inmutable/)

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM crew_payroll WHERE id = $1`, payroll.id),
    ).rejects.toThrow(/borrar/)
  })

  it('borrar una liquidación NO pagada sí funciona (RETURN OLD, no NULL)', async () => {
    const payroll = await createCrewPayroll()
    const deleted = await prisma.$executeRawUnsafe(
      `DELETE FROM crew_payroll WHERE id = $1`,
      payroll.id,
    )
    expect(deleted).toBe(1)
  })

  it('el nombre congelado no puede quedar vacío', async () => {
    await expect(createCrewPayroll({ crewNameSnapshot: '   ' })).rejects.toThrow()
  })
})
