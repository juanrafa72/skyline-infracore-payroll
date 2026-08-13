/**
 * Prueba del proceso completo, contra la base de datos real.
 *
 * Recorre lo mismo que hace una persona en una semana: elegir gente, marcar
 * días, calcular, enviar, aprobar y pagar. Comprueba también lo que NO debe
 * poder hacerse.
 *
 * Existe porque el chequeo de pantallas solo mira que abran, y los errores que
 * llegaron al negocio estaban en lo que pasa al oprimir los botones.
 *
 * Uso:  npx tsx scripts/flow-check.mts
 *       DATABASE_URL=... npx tsx scripts/flow-check.mts   (contra producción)
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from '../src/lib/db/url'
import { currentRoster, removeFromRoster, setRoster } from '../src/lib/payroll/roster'
import { applyTransition, invalidateIfStale } from '../src/lib/payroll/workflow/service'
import { calculateWorkerPayroll } from '../src/lib/payroll/engine/index'
import { toCents, toDecimalString } from '../src/lib/payroll/engine/money'
import { DEFAULT_SETTINGS } from '../src/lib/payroll/engine/types'
import { periodOf } from '../src/lib/payroll/period'
import type { CurrentUser } from '../src/lib/auth/rbac'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) })

const PREFIX = 'flowcheck'
let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  ok     ${name}`)
  } else {
    failed += 1
    console.log(`  FALLA  ${name}${detail ? `  → ${detail}` : ''}`)
  }
}

async function cleanup() {
  /*
   * Los candados de la base impiden borrar una nómina pagada y tocar el registro
   * de auditoría — que es justo lo que deben hacer. Para limpiar los datos de
   * esta prueba se desactivan un momento; es un privilegio que la aplicación
   * nunca tiene.
   */
  await prisma.$executeRawUnsafe('ALTER TABLE worker_payroll DISABLE TRIGGER worker_payroll_immutable')
  await prisma.$executeRawUnsafe('ALTER TABLE payroll_line DISABLE TRIGGER payroll_line_immutable')
  await prisma.$executeRawUnsafe('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_delete')
  try {
    await prisma.auditLog.deleteMany({ where: { companyId: PREFIX } })
    await prisma.workEntry.deleteMany({ where: { companyId: PREFIX } })
  await prisma.payrollLine.deleteMany({ where: { workerPayroll: { companyId: PREFIX } } })
  await prisma.exception.deleteMany({ where: { companyId: PREFIX } })
  await prisma.payment.deleteMany({ where: { companyId: PREFIX } })
  await prisma.workerPayroll.deleteMany({ where: { companyId: PREFIX } })
  await prisma.payrollWeekMember.deleteMany({ where: { companyId: PREFIX } })
  await prisma.payrollWeek.deleteMany({ where: { companyId: PREFIX } })
  await prisma.workerRate.deleteMany({ where: { companyId: PREFIX } })
  await prisma.worker.deleteMany({ where: { companyId: PREFIX } })
  await prisma.operation.deleteMany({ where: { companyId: PREFIX } })
    await prisma.company.deleteMany({ where: { id: PREFIX } })
    for (const email of ['flow-leo@check', 'flow-rafael@check', 'flow-teso@check']) {
      const user = await prisma.user.findUnique({ where: { email } })
      if (user) {
        await prisma.userSession.deleteMany({ where: { userId: user.id } })
        await prisma.userCompanyRole.deleteMany({ where: { userId: user.id } })
        await prisma.user.delete({ where: { id: user.id } })
      }
    }
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE worker_payroll ENABLE TRIGGER worker_payroll_immutable')
    await prisma.$executeRawUnsafe('ALTER TABLE payroll_line ENABLE TRIGGER payroll_line_immutable')
    await prisma.$executeRawUnsafe('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_delete')
  }
}

const ALL = [
  'payroll:view', 'payroll:create', 'payroll:edit', 'payroll:submit',
  'payroll:approve', 'payroll:reject', 'payroll:return', 'payment:execute',
]

function actor(id: string, email: string): CurrentUser {
  return {
    id, name: email, email,
    companyId: PREFIX, companyCode: 'FLOW', companyName: 'Flow',
    roleCodes: [], permissions: new Set(ALL), availableCompanies: [],
  }
}

async function main() {
  console.log('\nProceso completo de una semana\n')
  await cleanup()

  // ── Preparar el escenario
  await prisma.company.create({
    data: { id: PREFIX, code: 'FLOW_CHECK', legalName: 'Flow', displayName: 'Flow' },
  })
  const operation = await prisma.operation.create({
    data: { companyId: PREFIX, code: 'UG', name: 'Underground' },
  })
  const week = await prisma.payrollWeek.create({
    data: {
      companyId: PREFIX, year: 2026, weekNumber: 30,
      startDate: new Date('2026-07-19T00:00:00Z'),
      endDate: new Date('2026-07-25T00:00:00Z'),
      label: 'Semana 30',
    },
  })

  const worker = await prisma.worker.create({
    data: {
      companyId: PREFIX, code: 'FW1', firstName: 'Federico', lastName: 'Quintero',
      displayName: 'Federico Quintero', defaultOperationId: operation.id,
    },
  })
  // Tarifa amarrada a la operación, como las que vinieron del Excel.
  await prisma.workerRate.create({
    data: {
      companyId: PREFIX, workerId: worker.id, rateType: 'DAILY', amount: '200.00',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'), operationId: operation.id,
    },
  })

  const users = []
  for (const [email, name] of [
    ['flow-leo@check', 'Leo'], ['flow-rafael@check', 'Rafael'], ['flow-teso@check', 'Tesorería'],
  ] as const) {
    users.push(
      await prisma.user.upsert({ where: { email }, update: {}, create: { email, name } }),
    )
  }
  const leo = actor(users[0]!.id, 'flow-leo@check')
  const rafael = actor(users[1]!.id, 'flow-rafael@check')
  const tesoreria = actor(users[2]!.id, 'flow-teso@check')

  // ── 1. Elegir a la gente
  console.log('1. Elegir quién trabajó')
  const roster = await setRoster(PREFIX, week.id, [worker.id])
  check('agrega a la persona', roster.ok, roster.message)
  check('queda en la lista', (await currentRoster(PREFIX, week.id)).length === 1)

  // ── 2. Marcar días (heredando la operación de la persona, como hace la pantalla)
  console.log('\n2. Marcar los días')
  const days = ['2026-07-19', '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23']
  for (const day of days) {
    await prisma.workEntry.create({
      data: {
        companyId: PREFIX, payrollWeekId: week.id, workerId: worker.id,
        workDate: new Date(`${day}T00:00:00Z`), dayType: 'FULL_DAY',
        operationId: worker.defaultOperationId,
      },
    })
  }
  check('quedan 5 días marcados',
    (await prisma.workEntry.count({ where: { payrollWeekId: week.id } })) === 5)

  const blocked = await removeFromRoster(PREFIX, week.id, worker.id)
  check('no deja quitarla teniendo días', !blocked.ok, blocked.message)
  check('el aviso explica qué hacer', /marcado/.test(blocked.message))

  // ── 3. Calcular
  console.log('\n3. Calcular')
  const entries = await prisma.workEntry.findMany({ where: { payrollWeekId: week.id } })
  const rates = await prisma.workerRate.findMany({ where: { workerId: worker.id } })

  const result = calculateWorkerPayroll({
    workerId: worker.id,
    compensationType: 'DAILY_RATE',
    fixedWeeklyAmount: null,
    entries: entries.map((entry) => ({
      id: entry.id,
      workDate: entry.workDate.toISOString().slice(0, 10),
      dayType: entry.dayType,
      hoursWorked: null,
      shift: entry.shift,
      projectId: entry.projectId,
      crewId: entry.crewId,
      operationId: entry.operationId,
    })),
    rates: rates.map((rate) => ({
      id: rate.id,
      rateType: rate.rateType,
      amount: toCents(rate.amount.toString()),
      shift: rate.shift,
      projectId: rate.projectId,
      operationId: rate.operationId,
      effectiveFrom: rate.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: rate.effectiveTo?.toISOString().slice(0, 10) ?? null,
    })),
    additions: [], manualDeductions: [], advances: [], debts: [],
    settings: DEFAULT_SETTINGS,
  })

  check('encuentra la tarifa (el error reportado)', result.exceptions.length === 0,
    result.exceptions.map((e) => e.detail).join(' · '))
  check('5 días × $200 = $1.000', toDecimalString(result.netPay) === '1000.00',
    toDecimalString(result.netPay))

  const payroll = await prisma.workerPayroll.create({
    data: {
      companyId: PREFIX, payrollWeekId: week.id, workerId: worker.id, status: 'PREPARED',
      daysFull: result.daysFull, basePay: toDecimalString(result.basePay),
      grossPay: toDecimalString(result.grossPay), netPay: toDecimalString(result.netPay),
    },
  })

  // ── 4. Enviar y aprobar
  console.log('\n4. Enviar y aprobar')
  await applyTransition(leo, [payroll.id], 'SUBMIT')
  check('Leo la envía',
    (await prisma.workerPayroll.findUniqueOrThrow({ where: { id: payroll.id } })).status ===
      'PENDING_APPROVAL')

  const selfApprove = await applyTransition(leo, [payroll.id], 'APPROVE')
  check('Leo NO puede aprobar lo suyo', selfApprove.moved === 0, selfApprove.skipped[0]?.reason)

  await applyTransition(rafael, [payroll.id], 'APPROVE')
  const approved = await prisma.workerPayroll.findUniqueOrThrow({ where: { id: payroll.id } })
  check('Rafael la aprueba', approved.status === 'APPROVED')
  check('queda la huella congelada', approved.calculationHash !== null)

  // ── 5. Cambiar algo después de aprobar
  console.log('\n5. Cambiar un día después de aprobar')
  const first = entries[0]!
  await prisma.workEntry.update({ where: { id: first.id }, data: { dayType: 'HALF_DAY' } })
  const invalidated = await invalidateIfStale(payroll.id)
  const after = await prisma.workerPayroll.findUniqueOrThrow({ where: { id: payroll.id } })
  check('la aprobación se cae sola', invalidated && after.status === 'PENDING_APPROVAL')
  check('queda registrado como error',
    (await prisma.exception.count({
      where: { entityId: payroll.id, code: 'CHANGED_AFTER_APPROVAL' },
    })) > 0)

  // Con un error crítico abierto no se puede aprobar: hay que resolverlo antes.
  await prisma.workEntry.update({ where: { id: first.id }, data: { dayType: 'FULL_DAY' } })
  const blockedByError = await applyTransition(rafael, [payroll.id], 'APPROVE')
  check('no deja aprobar con un error crítico abierto', blockedByError.moved === 0,
    blockedByError.skipped[0]?.reason)

  await prisma.exception.updateMany({
    where: { entityId: payroll.id, status: 'OPEN' },
    data: { status: 'RESOLVED', resolvedAt: new Date(), resolutionNote: 'Revisado en la prueba' },
  })
  const reApproved = await applyTransition(rafael, [payroll.id], 'APPROVE')
  check('tras resolverlo, sí aprueba', reApproved.moved === 1,
    reApproved.skipped[0]?.reason)

  // ── 6. Pagar
  console.log('\n6. Pagar')
  const selfPay = await applyTransition(rafael, [payroll.id], 'START_PAYMENT')
  check('quien aprobó NO puede pagar', selfPay.moved === 0, selfPay.skipped[0]?.reason)

  const started = await applyTransition(tesoreria, [payroll.id], 'START_PAYMENT')
  check('tesorería inicia el pago', started.moved === 1)

  await prisma.payment.create({
    data: {
      companyId: PREFIX, paymentNumber: 'FLOW-1', payeeType: 'WORKER', workerId: worker.id,
      payrollWeekId: week.id, approvedAmount: '1000.00', amountPaid: '1000.00',
      paymentDate: new Date('2026-07-26T00:00:00Z'), method: 'ZELLE',
      reference: 'FLOW-REF-1', status: 'PAID', paidById: tesoreria.id, paidAt: new Date(),
    },
  })
  await applyTransition(tesoreria, [payroll.id], 'CONFIRM_PAYMENT')
  const paid = await prisma.workerPayroll.findUniqueOrThrow({ where: { id: payroll.id } })
  check('queda pagada', paid.status === 'PAID')

  // ── 7. Lo que ya no se puede tocar
  console.log('\n7. Lo que ya no se puede tocar')
  let immutable = false
  try {
    await prisma.workerPayroll.update({
      where: { id: payroll.id }, data: { netPay: '9999.00' },
    })
  } catch {
    immutable = true
  }
  check('no se puede cambiar el neto de una nómina pagada', immutable)

  let auditProtected = false
  try {
    await prisma.auditLog.updateMany({
      where: { entityId: payroll.id }, data: { action: 'ALTERADO' },
    })
  } catch {
    auditProtected = true
  }
  check('no se puede alterar el registro de auditoría', auditProtected)

  const trail = await prisma.auditLog.count({ where: { entityId: payroll.id } })
  check('quedó rastro de todo el proceso', trail >= 5, `${trail} anotaciones`)

  // ── 8. Períodos
  console.log('\n8. Períodos de pago')
  check('semanal: 19–25 jul es la semana 30', periodOf('2026-07-22', 'WEEKLY').periodNumber === 30)
  check('quincenal: del 16 al fin de mes',
    periodOf('2026-07-20', 'SEMI_MONTHLY').endDate === '2026-07-31')
  check('mensual: julio tiene 31 días', periodOf('2026-07-10', 'MONTHLY').days.length === 31)

  await cleanup()

  console.log(`\n${passed}/${passed + failed} comprobaciones correctas`)
  if (failed > 0) process.exitCode = 1
}

await main()
await prisma.$disconnect()
