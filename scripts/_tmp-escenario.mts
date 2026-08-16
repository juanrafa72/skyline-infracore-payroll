/** Deja el escenario de Hugo montado para verlo en pantalla. */
import 'dotenv/config'
import { prisma } from '@/lib/db/client'
import { saveCrewBreakdown, saveExpectedTotal } from '@/lib/payroll/contractors/service'
import { syncCrewPayrolls } from '@/lib/payroll/crews/service'
import type { CurrentUser } from '@/lib/auth/rbac'
const company = await prisma.company.findFirstOrThrow({ where: { code: 'SKYLINE' } })
const admin = await prisma.user.findFirstOrThrow({ where: { status: 'ACTIVE' } })
const user: CurrentUser = { id: admin.id, name: admin.name, email: admin.email, companyId: company.id, companyCode: company.code, companyName: company.displayName, roleCodes: [], permissions: new Set(['payroll:edit']), availableCompanies: [] }
const week = await prisma.payrollWeek.findFirstOrThrow({ where: { companyId: company.id, year: 2026, weekNumber: 33 } })
const MARCA = 'HUGO-PRUEBA'
for (const c of await prisma.crew.findMany({ where: { code: MARCA } })) {
  await prisma.crewPayrollMember.deleteMany({ where: { crewPayroll: { crewId: c.id } } })
  await prisma.crewPayroll.deleteMany({ where: { crewId: c.id } })
  await prisma.production.deleteMany({ where: { crewId: c.id } })
  await prisma.crew.delete({ where: { id: c.id } })
}
await prisma.contractor.deleteMany({ where: { companyId: company.id, name: 'Hugo' } })
const contratista = await prisma.contractor.create({ data: { companyId: company.id, name: 'Hugo' } })
const crew = await prisma.crew.create({ data: { companyId: company.id, code: MARCA, name: 'CUADRILLA HUGO', contractorId: contratista.id } })
const project = await prisma.project.findFirstOrThrow({ where: { companyId: company.id } })
await prisma.production.create({ data: { companyId: company.id, payrollWeekId: week.id, projectId: project.id, crewId: crew.id, contractorId: contratista.id, productionDate: week.startDate, unitCode: 'FOOT', unitLabel: 'pies', unitOfMeasure: 'FOOT', quantity: '10000', appliedPrice: '0.5000', amount: '5000.00' } })
await syncCrewPayrolls(company.id, week.id)
const p = await prisma.crewPayroll.findFirstOrThrow({ where: { crewId: crew.id } })
await saveCrewBreakdown(user, { crewPayrollId: p.id, members: [
  { name: 'Francisco', rateAmount: '1200.00', quantity: '1' },
  { name: 'Juan', rateAmount: '1100.00', quantity: '1' },
  { name: 'Eduardo', rateAmount: '1000.00', quantity: '1' },
  { name: 'Hugo', rateAmount: '1700.00', quantity: '1', isContractor: true },
]})
await saveExpectedTotal(user, { crewPayrollId: p.id, expectedTotal: '5000.00' })
console.log('escenario listo · semana', week.id)
await prisma.$disconnect()
