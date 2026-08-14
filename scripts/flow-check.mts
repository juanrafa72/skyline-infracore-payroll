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
import {
  assignRecipient,
  generateOrders,
  payOrder,
  previewApproval,
} from '../src/lib/disbursement/orders'
import { createRecipient } from '../src/lib/disbursement/recipients'
import { renderDisbursementPdf } from '../src/lib/pdf/disbursement'
import { toCents, toDecimalString } from '../src/lib/payroll/engine/money'
import { DEFAULT_SETTINGS } from '../src/lib/payroll/engine/types'
import { periodOf } from '../src/lib/payroll/period'
import { ratesStatus, saveMissingRate } from '../src/lib/payroll/rates-status/service'
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
  await prisma.$executeRawUnsafe('ALTER TABLE disbursement_order DISABLE TRIGGER disbursement_order_immutable')
  await prisma.$executeRawUnsafe('ALTER TABLE disbursement_order_item DISABLE TRIGGER disbursement_item_immutable')
  await prisma.$executeRawUnsafe('ALTER TABLE payment_recipient DISABLE TRIGGER payment_recipient_keep_history')
  try {
    await prisma.auditLog.deleteMany({ where: { companyId: PREFIX } })
    await prisma.disbursementDocument.deleteMany({ where: { companyId: PREFIX } })
    await prisma.disbursementOrderItem.deleteMany({ where: { companyId: PREFIX } })
    await prisma.disbursementOrder.deleteMany({ where: { companyId: PREFIX } })
    await prisma.paymentRecipient.deleteMany({ where: { companyId: PREFIX } })
    await prisma.$executeRawUnsafe('DELETE FROM document_sequence WHERE "companyId" = $1', PREFIX)
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
    await prisma.$executeRawUnsafe('ALTER TABLE disbursement_order ENABLE TRIGGER disbursement_order_immutable')
    await prisma.$executeRawUnsafe('ALTER TABLE disbursement_order_item ENABLE TRIGGER disbursement_item_immutable')
    await prisma.$executeRawUnsafe('ALTER TABLE payment_recipient ENABLE TRIGGER payment_recipient_keep_history')
  }
}

const ALL = [
  'payroll:view', 'payroll:create', 'payroll:edit', 'payroll:submit',
  'payroll:approve', 'payroll:reject', 'payroll:return', 'payment:execute',
  'payment:view', 'payment:proof:upload',
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
    (await prisma.workEntry.count({ where: { payrollWeekId: week.id, workerId: worker.id } })) === 5)

  // Quitar: se prueba con OTRA persona para no alterar el resto del recorrido.
  const extra = await prisma.worker.create({
    data: {
      companyId: PREFIX, code: 'FW2', firstName: 'Otro', lastName: 'Trabajador',
      displayName: 'Otro Trabajador', defaultOperationId: operation.id,
    },
  })
  await setRoster(PREFIX, week.id, [extra.id])
  await prisma.workEntry.create({
    data: {
      companyId: PREFIX, payrollWeekId: week.id, workerId: extra.id,
      workDate: new Date('2026-07-19T00:00:00Z'), dayType: 'FULL_DAY',
      operationId: operation.id,
    },
  })
  const removed = await removeFromRoster(PREFIX, week.id, extra.id)
  check('quitar borra a la persona y sus días en un paso', removed.ok, removed.message)
  check('dice cuántos días borró', /1 día/.test(removed.message), removed.message)
  check('ya no está en la semana',
    !(await currentRoster(PREFIX, week.id)).includes(extra.id))

  // ── 3. Calcular
  console.log('\n3. Calcular')
  const entries = await prisma.workEntry.findMany({
    where: { payrollWeekId: week.id, workerId: worker.id },
  })
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

  // Sin decir a qué empresa se le transfiere el dinero no se puede aprobar.
  const noRecipient = await applyTransition(rafael, [payroll.id], 'APPROVE')
  check('NO se aprueba sin empresa receptora', noRecipient.moved === 0,
    noRecipient.skipped[0]?.reason)

  const recipient = await createRecipient(rafael, {
    name: 'Receptora de la prueba',
    taxId: '00-1111111',
  })
  check('se crea la empresa receptora', recipient.ok, recipient.message)

  const assigned = await assignRecipient(rafael, [payroll.id], recipient.recipientId!)
  check('se le asigna a la persona', assigned.assigned === 1, assigned.message)

  const preview = await previewApproval(PREFIX, [payroll.id])
  check('el resumen cuadra con lo aprobado', preview.balanced && preview.grandTotal === '1000.00',
    `${preview.grandTotal} · ${preview.balanceMessage ?? ''}`)

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

  // ── 6. Orden de desembolso
  console.log('\n6. Orden de desembolso')
  const generated = await generateOrders(rafael, [payroll.id])
  check('se genera la orden al aprobar', generated.ok, generated.message)

  const order = await prisma.disbursementOrder.findFirst({
    where: { companyId: PREFIX },
    include: { items: true },
  })
  check('tiene consecutivo', /^OD-FLOW_CHECK-\d{4}-\d{4}$/.test(order?.orderNumber ?? ''),
    order?.orderNumber)
  check('el total de la orden es el neto aprobado', order?.totalAmount.toFixed(2) === '1000.00',
    order?.totalAmount.toFixed(2))
  check('trae a la persona con su monto',
    order?.items.length === 1 && order.items[0]!.amount.toFixed(2) === '1000.00')
  check('congela los nombres para el documento',
    order?.recipientNameSnapshot === 'Receptora de la prueba' &&
      order.weekLabelSnapshot.includes('Semana 30'))

  // El PDF que va a contabilidad tiene que traer el detalle, no solo el total.
  const pdf = renderDisbursementPdf({
    orderNumber: order!.orderNumber, status: 'Pendiente de pago',
    companyName: order!.companyNameSnapshot, recipientName: order!.recipientNameSnapshot,
    recipientTaxId: order!.recipientTaxIdSnapshot, weekLabel: order!.weekLabelSnapshot,
    periodStart: '2026-07-19', periodEnd: '2026-07-25', createdAt: '2026-07-26',
    workers: order!.items.map((item) => ({
      name: item.workerNameSnapshot, amount: item.amount.toFixed(2), paid: false,
    })),
    total: order!.totalAmount.toFixed(2), amountPaid: '0.00',
    preparedBy: order!.preparedByName, approvedBy: order!.approvedByName,
    approvedAt: '2026-07-26', paidBy: null, paidAt: null, paymentDate: null,
    method: null, bankName: null, reference: null, notes: null,
    differenceReason: null, cancellationReason: null,
  }).toString('latin1')
  check('el PDF trae el nombre y el monto de la persona',
    pdf.includes('Federico Quintero') && pdf.includes('1,000.00'))

  // ── 7. Pagar
  console.log('\n7. Pagar')
  const selfPay = await payOrder(rafael, {
    orderId: order!.id, paymentDate: '2026-07-26', method: 'ZELLE',
    reference: 'FLOW-REF-0', amountPaid: '1000.00',
  })
  check('quien aprobó NO puede pagar', !selfPay.ok, selfPay.message)

  const wrongAmount = await payOrder(tesoreria, {
    orderId: order!.id, paymentDate: '2026-07-26', method: 'ZELLE',
    reference: 'FLOW-REF-X', amountPaid: '900.00',
  })
  check('un monto que no cuadra con nadie se rechaza', !wrongAmount.ok, wrongAmount.message)

  const payment = await payOrder(tesoreria, {
    orderId: order!.id, paymentDate: '2026-07-26', method: 'ZELLE',
    bankName: 'Banco de la prueba', reference: 'FLOW-REF-1', amountPaid: '1000.00',
  })
  check('tesorería registra la transferencia', payment.ok, payment.message)

  const paid = await prisma.workerPayroll.findUniqueOrThrow({ where: { id: payroll.id } })
  check('queda pagada', paid.status === 'PAID')
  const settledOrder = await prisma.disbursementOrder.findUniqueOrThrow({
    where: { id: order!.id },
  })
  check('la orden queda pagada', settledOrder.status === 'PAID')
  check('quedó quién pagó y con qué referencia',
    settledOrder.paidById === tesoreria.id && settledOrder.reference === 'FLOW-REF-1')

  let orderImmutable = false
  try {
    await prisma.disbursementOrder.update({
      where: { id: order!.id }, data: { totalAmount: '5000.00' },
    })
  } catch {
    orderImmutable = true
  }
  check('una orden pagada ya no se modifica', orderImmutable)

  // ── 8. Lo que ya no se puede tocar
  console.log('\n8. Lo que ya no se puede tocar')
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
  console.log('\n9. Períodos de pago')
  check('semanal: 19–25 jul es la semana 30', periodOf('2026-07-22', 'WEEKLY').periodNumber === 30)
  check('quincenal: del 16 al fin de mes',
    periodOf('2026-07-20', 'SEMI_MONTHLY').endDate === '2026-07-31')
  check('mensual: julio tiene 31 días', periodOf('2026-07-10', 'MONTHLY').days.length === 31)

  // ── 10. Tarifas faltantes
  console.log('\n10. Tarifas faltantes')
  const sinTarifa = await prisma.worker.create({
    data: {
      companyId: PREFIX, code: 'FW3', firstName: 'Sin', lastName: 'Tarifa',
      displayName: 'SIN TARIFA (FLOW)',
    },
  })
  const antes = await ratesStatus(PREFIX, '2026-07-22')
  const fila = antes.missing.find((row) => row.workerId === sinTarifa.id)
  check('la persona sin tarifa aparece como faltante', fila !== undefined)
  check('con su porqué en cristiano', (fila?.why ?? '').includes('ninguna tarifa'), fila?.why ?? '')
  check('la persona CON tarifa no aparece', !antes.missing.some((row) => row.workerId === worker.id))

  const guardada = await saveMissingRate(rafael, {
    workerId: sinTarifa.id, amount: '150', effectiveFrom: '2026-07-19',
  })
  check('se guarda desde la pantalla de faltantes', guardada.ok, guardada.message)
  const despues = await ratesStatus(PREFIX, '2026-07-22')
  check('deja de aparecer como faltante', !despues.missing.some((row) => row.workerId === sinTarifa.id))

  const subida = await saveMissingRate(rafael, {
    workerId: sinTarifa.id, amount: '175', effectiveFrom: '2026-07-26',
  })
  check('subirla cierra la anterior sin hueco ni solape',
    subida.ok && subida.message.includes('quedó cerrada'), subida.message)
  const solapada = await saveMissingRate(rafael, {
    workerId: sinTarifa.id, amount: '160', effectiveFrom: '2026-07-20',
  })
  check('una vigencia que empieza antes de la actual se rechaza', !solapada.ok, solapada.message)

  await cleanup()

  console.log(`\n${passed}/${passed + failed} comprobaciones correctas`)
  if (failed > 0) process.exitCode = 1
}

await main()
await prisma.$disconnect()
