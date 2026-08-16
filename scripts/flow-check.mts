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
import { applyTransition, currentHash, invalidateIfStale } from '../src/lib/payroll/workflow/service'
import { applyPayableTransition } from '../src/lib/payroll/workflow/payables'
import { syncCrewPayrolls } from '../src/lib/payroll/crews/service'
import { syncEquipmentPayrolls } from '../src/lib/payroll/equipment/service'
import { assignRecipientToPayables } from '../src/lib/disbursement/orders'
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
import { pendingBoard, weekFocus } from '../src/lib/payroll/home'
import { cerrarAviso } from '../src/lib/payroll/exceptions/service'
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
  await prisma.$executeRawUnsafe('ALTER TABLE crew_payroll DISABLE TRIGGER crew_payroll_immutable')
  await prisma.$executeRawUnsafe('ALTER TABLE equipment_payroll DISABLE TRIGGER equipment_payroll_immutable')
  try {
    await prisma.auditLog.deleteMany({ where: { companyId: PREFIX } })
    // Los renglones de orden apuntan a las liquidaciones con FK RESTRICT:
    // primero se borran los renglones, después las liquidaciones.
    await prisma.disbursementDocument.deleteMany({ where: { companyId: PREFIX } })
    await prisma.disbursementOrderItem.deleteMany({ where: { companyId: PREFIX } })
    await prisma.disbursementOrder.deleteMany({ where: { companyId: PREFIX } })
    // Los pagos ANTES que contratistas/proveedores: borrar al beneficiario
    // primero pondría el pago en nulo y saltaría payment_single_payee.
    await prisma.payment.deleteMany({ where: { companyId: PREFIX } })
    await prisma.production.deleteMany({ where: { companyId: PREFIX } })
    await prisma.crewPayroll.deleteMany({ where: { companyId: PREFIX } })
    await prisma.equipmentPayroll.deleteMany({ where: { companyId: PREFIX } })
    await prisma.equipmentEntry.deleteMany({ where: { companyId: PREFIX } })
    await prisma.crewPricing.deleteMany({ where: { companyId: PREFIX } })
    await prisma.crew.deleteMany({ where: { companyId: PREFIX } })
    await prisma.contractor.deleteMany({ where: { companyId: PREFIX } })
    await prisma.equipment.deleteMany({ where: { companyId: PREFIX } })
    await prisma.vendor.deleteMany({ where: { companyId: PREFIX } })
    await prisma.paymentRecipient.deleteMany({ where: { companyId: PREFIX } })
    await prisma.$executeRawUnsafe('DELETE FROM document_sequence WHERE "companyId" = $1', PREFIX)
    await prisma.workEntry.deleteMany({ where: { companyId: PREFIX } })
  await prisma.payrollLine.deleteMany({ where: { workerPayroll: { companyId: PREFIX } } })
  await prisma.exception.deleteMany({ where: { companyId: PREFIX } })
  await prisma.workerPayroll.deleteMany({ where: { companyId: PREFIX } })
  await prisma.payrollWeekMember.deleteMany({ where: { companyId: PREFIX } })
  await prisma.payrollWeek.deleteMany({ where: { companyId: PREFIX } })
  await prisma.workerRate.deleteMany({ where: { companyId: PREFIX } })
  await prisma.worker.deleteMany({ where: { companyId: PREFIX } })
  // Los proyectos, después de todo lo que los apunta (días, líneas, tarifas) y
  // antes de la operación, que ellos mismos apuntan.
  await prisma.project.deleteMany({ where: { companyId: PREFIX } })
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
    await prisma.$executeRawUnsafe('ALTER TABLE crew_payroll ENABLE TRIGGER crew_payroll_immutable')
    await prisma.$executeRawUnsafe('ALTER TABLE equipment_payroll ENABLE TRIGGER equipment_payroll_immutable')
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

  const preview = await previewApproval(PREFIX, { workerPayrollIds: [payroll.id] })
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

  /*
   * Se cierra POR LA PANTALLA, con el mismo servicio que usa el botón.
   *
   * Antes esta prueba hacía un UPDATE directo a la base, y por eso pasaba en
   * verde mientras la aplicación no tenía NINGÚN sitio donde cerrar un aviso:
   * el negocio quedaba trancado sin salida y la revisión no se enteraba.
   */
  const sinNota = await cerrarAviso(rafael, {
    id: (await prisma.exception.findFirstOrThrow({
      where: { entityId: payroll.id, status: 'OPEN' },
    })).id,
    cierre: 'RESOLVED',
    nota: ' ',
  })
  check('cerrar un aviso sin explicar por qué NO se permite', !sinNota.ok, sinNota.message)

  const abierto = await prisma.exception.findFirstOrThrow({
    where: { entityId: payroll.id, status: 'OPEN' },
  })
  const cerrado = await cerrarAviso(rafael, {
    id: abierto.id,
    cierre: 'RESOLVED',
    nota: 'Revisé los días y quedaron correctos',
  })
  check('el aviso se cierra desde la pantalla, con nota y autor', cerrado.ok, cerrado.message)
  check('queda el rastro de quién lo cerró y por qué',
    (await prisma.auditLog.count({
      where: { entityType: 'Exception', entityId: abierto.id, action: 'EXCEPTION_RESOLVED' },
    })) === 1)

  const reApproved = await applyTransition(rafael, [payroll.id], 'APPROVE')
  check('tras resolverlo, sí aprueba', reApproved.moved === 1,
    reApproved.skipped[0]?.reason)

  /*
   * Un aviso que trajo el Excel NO puede frenar una semana nueva.
   *
   * Este era el callejón sin salida: días duplicados del histórico —que ya se
   * pagó por fuera— bloqueaban aprobaciones sin relación con ellos, y no había
   * dónde cerrarlos.
   */
  await prisma.exception.create({
    data: {
      companyId: PREFIX,
      code: 'DUPLICATE_WORK_ENTRY',
      level: 'CRITICAL',
      entityType: 'ImportBatch',
      title: 'Día duplicado en el Excel',
      detail: 'Viene del archivo histórico.',
    },
  })
  // Se devuelve a la mesa de aprobación para volver a intentarlo con el aviso
  // del histórico abierto: si frenara, la nómina no pasaría.
  await applyTransition(rafael, [payroll.id], 'RETURN', 'prueba del aviso del histórico')
  const conHistorico = await applyTransition(rafael, [payroll.id], 'APPROVE')
  check('un aviso del archivo del Excel NO frena una semana nueva',
    conHistorico.moved === 1, conHistorico.skipped[0]?.reason)

  // ── 6. Orden de desembolso
  console.log('\n6. Orden de desembolso')
  const generated = await generateOrders(rafael, { workerPayrollIds: [payroll.id] })
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
  check('congela también contra qué se paga: 5 días',
    order?.items[0]!.itemDetailSnapshot === '5 días', order?.items[0]!.itemDetailSnapshot ?? 'sin detalle')

  // El PDF que va a contabilidad tiene que traer el detalle, no solo el total.
  const pdf = renderDisbursementPdf({
    orderNumber: order!.orderNumber, status: 'Pendiente de pago',
    companyName: order!.companyNameSnapshot, recipientName: order!.recipientNameSnapshot,
    recipientTaxId: order!.recipientTaxIdSnapshot, weekLabel: order!.weekLabelSnapshot,
    periodStart: '2026-07-19', periodEnd: '2026-07-25', createdAt: '2026-07-26',
    workers: order!.items.map((item) => ({
      name: item.itemNameSnapshot, detail: item.itemDetailSnapshot,
      amount: item.amount.toFixed(2), paid: false, group: item.crewLabelSnapshot,
    })),
    total: order!.totalAmount.toFixed(2), amountPaid: '0.00',
    preparedBy: order!.preparedByName, approvedBy: order!.approvedByName,
    approvedAt: '2026-07-26', paidBy: null, paidAt: null, paymentDate: null,
    method: null, bankName: null, reference: null, notes: null,
    differenceReason: null, cancellationReason: null,
  }).toString('latin1')
  check('el PDF trae el nombre y el monto de la persona',
    pdf.includes('Federico Quintero') && pdf.includes('1,000.00'))
  check('el PDF dice contra cuántos días va ese pago',
    pdf.includes('5 d') && pdf.includes('CONTRA QU'))

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

  // ── 11. Cuadrilla: producción → deuda con el contratista → orden → pago
  console.log('\n11. Cuadrilla que se paga al contratista')
  const contractor = await prisma.contractor.create({
    data: { companyId: PREFIX, name: 'Contratista Flow' },
  })
  const crew = await prisma.crew.create({
    data: { companyId: PREFIX, code: 'FC1', name: 'Cuadrilla Flow' },
  })
  await prisma.production.create({
    data: {
      companyId: PREFIX, payrollWeekId: week.id, crewId: crew.id,
      productionDate: new Date('2026-07-21T00:00:00Z'),
      unitCode: 'FIBER', unitLabel: 'Fibra', quantity: '8500.00',
      appliedPrice: '0.5', amount: '4250.00',
    },
  })

  await syncCrewPayrolls(PREFIX, week.id)
  const crewPayable = await prisma.crewPayroll.findUniqueOrThrow({
    where: {
      companyId_payrollWeekId_crewId: {
        companyId: PREFIX, payrollWeekId: week.id, crewId: crew.id,
      },
    },
  })
  check('calcular convierte la producción en deuda con el contratista',
    crewPayable.productionTotal.toFixed(2) === '4250.00', crewPayable.productionTotal.toFixed(2))

  await applyPayableTransition(leo, 'CREW', [crewPayable.id], 'SUBMIT')
  await assignRecipientToPayables(rafael, { crewPayrollIds: [crewPayable.id] }, recipient.recipientId!)

  const sinContratista = await applyPayableTransition(rafael, 'CREW', [crewPayable.id], 'APPROVE')
  check('sin contratista NO se aprueba: no hay a quién pagarle',
    sinContratista.moved === 0 && (sinContratista.skipped[0]?.reason ?? '').includes('contratista'),
    sinContratista.skipped[0]?.reason)

  await applyPayableTransition(rafael, 'CREW', [crewPayable.id], 'REJECT', 'Ponerle el contratista')
  await prisma.crew.update({ where: { id: crew.id }, data: { contractorId: contractor.id } })
  await syncCrewPayrolls(PREFIX, week.id)
  await applyPayableTransition(leo, 'CREW', [crewPayable.id], 'SUBMIT')
  const crewApproved = await applyPayableTransition(rafael, 'CREW', [crewPayable.id], 'APPROVE')
  check('con contratista y receptora, Rafael la aprueba', crewApproved.moved === 1,
    crewApproved.skipped[0]?.reason)

  const crewOrders = await generateOrders(rafael, { crewPayrollIds: [crewPayable.id] })
  check('se genera la orden de la cuadrilla', crewOrders.ok && (crewOrders.orderNumbers?.length ?? 0) > 0,
    crewOrders.message)
  const crewItem = await prisma.disbursementOrderItem.findUniqueOrThrow({
    where: { crewPayrollId: crewPayable.id },
    include: { order: true },
  })
  check('el renglón congela nombre y cuadrilla',
    crewItem.itemNameSnapshot.includes('Cuadrilla Flow') && crewItem.crewLabelSnapshot === 'Cuadrilla Flow')

  const crewPay = await payOrder(tesoreria, {
    orderId: crewItem.order.id, paymentDate: '2026-07-26', method: 'ZELLE',
    reference: 'FLOW-REF-2', amountPaid: '4250.00',
  })
  check('tesorería paga la orden de la cuadrilla', crewPay.ok, crewPay.message)

  const crewPayment = await prisma.payment.findFirst({
    where: { companyId: PREFIX, disbursementOrderId: crewItem.order.id },
  })
  check('el pago queda a nombre del CONTRATISTA',
    crewPayment?.payeeType === 'CONTRACTOR' && crewPayment?.contractorId === contractor.id)

  const paidCrew = await prisma.crewPayroll.findUniqueOrThrow({ where: { id: crewPayable.id } })
  check('la liquidación de la cuadrilla queda pagada', paidCrew.status === 'PAID')

  // ── 12. Días de control: anotan, no pagan
  console.log('\n12. Días de control de la gente del crew')
  const miembro = await prisma.worker.create({
    data: {
      companyId: PREFIX, code: 'FW4', firstName: 'Miembro', lastName: 'Crew',
      displayName: 'MIEMBRO CREW', defaultCrewId: crew.id,
    },
  })
  await prisma.workEntry.create({
    data: {
      companyId: PREFIX, payrollWeekId: week.id, workerId: miembro.id,
      workDate: new Date('2026-07-21T00:00:00Z'), dayType: 'FULL_DAY',
      isControlOnly: true, crewId: crew.id,
    },
  })
  check('el día de control NO lo mete a la nómina de personal',
    !(await currentRoster(PREFIX, week.id)).includes(miembro.id))

  const huellaAntes = await currentHash(payroll.id)
  await prisma.workEntry.create({
    data: {
      companyId: PREFIX, payrollWeekId: week.id, workerId: worker.id,
      workDate: new Date('2026-07-25T00:00:00Z'), dayType: 'FULL_DAY',
      isControlOnly: true, crewId: crew.id,
    },
  })
  const huellaDespues = await currentHash(payroll.id)
  check('un día de control del mismo trabajador NO cambia su huella de aprobación',
    huellaAntes === huellaDespues)

  // ── 13. Equipo rentado: días → deuda con el proveedor → pago
  console.log('\n13. Equipo rentado que se paga al proveedor')
  const vendorRow = await prisma.vendor.create({
    data: { companyId: PREFIX, name: 'Rentas Flow' },
  })
  const machine = await prisma.equipment.create({
    data: {
      companyId: PREFIX, code: 'FE1', name: 'Camion Flow',
      ownership: 'RENTED', dailyCost: '450.00',
    },
  })
  await prisma.equipmentEntry.createMany({
    data: [20, 21, 22].map((day) => ({
      companyId: PREFIX, payrollWeekId: week.id, equipmentId: machine.id,
      workDate: new Date(`2026-07-${day}T00:00:00Z`),
    })),
  })

  await syncEquipmentPayrolls(PREFIX, week.id)
  const equipPayable = await prisma.equipmentPayroll.findUniqueOrThrow({
    where: {
      companyId_payrollWeekId_equipmentId: {
        companyId: PREFIX, payrollWeekId: week.id, equipmentId: machine.id,
      },
    },
  })
  check('3 días × $450 = $1.350,00 congelado',
    equipPayable.totalAmount.toFixed(2) === '1350.00' && equipPayable.appliedDailyCost.toFixed(2) === '450.00')

  await applyPayableTransition(leo, 'EQUIPMENT', [equipPayable.id], 'SUBMIT')
  await assignRecipientToPayables(
    rafael, { equipmentPayrollIds: [equipPayable.id] }, recipient.recipientId!,
  )
  const sinProveedor = await applyPayableTransition(rafael, 'EQUIPMENT', [equipPayable.id], 'APPROVE')
  check('sin proveedor NO se aprueba: un equipo jamás recibe pagos',
    sinProveedor.moved === 0 && (sinProveedor.skipped[0]?.reason ?? '').includes('proveedor'),
    sinProveedor.skipped[0]?.reason)

  await applyPayableTransition(rafael, 'EQUIPMENT', [equipPayable.id], 'REJECT', 'Ponerle proveedor')
  await prisma.equipment.update({ where: { id: machine.id }, data: { vendorId: vendorRow.id } })
  await syncEquipmentPayrolls(PREFIX, week.id)
  await applyPayableTransition(leo, 'EQUIPMENT', [equipPayable.id], 'SUBMIT')
  const equipApproved = await applyPayableTransition(rafael, 'EQUIPMENT', [equipPayable.id], 'APPROVE')
  check('con proveedor y receptora, se aprueba', equipApproved.moved === 1,
    equipApproved.skipped[0]?.reason)

  const equipOrders = await generateOrders(rafael, { equipmentPayrollIds: [equipPayable.id] })
  check('se genera la orden del equipo', equipOrders.ok && (equipOrders.orderNumbers?.length ?? 0) > 0,
    equipOrders.message)
  const equipItem = await prisma.disbursementOrderItem.findUniqueOrThrow({
    where: { equipmentPayrollId: equipPayable.id },
    include: { order: true },
  })
  check('el renglón queda bajo "Equipo rentado"', equipItem.crewLabelSnapshot === 'Equipo rentado')

  const equipPay = await payOrder(tesoreria, {
    orderId: equipItem.order.id, paymentDate: '2026-07-26', method: 'ZELLE',
    reference: 'FLOW-REF-3', amountPaid: '1350.00',
  })
  check('tesorería paga el alquiler', equipPay.ok, equipPay.message)
  const equipPayment = await prisma.payment.findFirst({
    where: { companyId: PREFIX, disbursementOrderId: equipItem.order.id },
  })
  check('el pago queda a nombre del PROVEEDOR (BR-121)',
    equipPayment?.payeeType === 'VENDOR' && equipPayment?.vendorId === vendorRow.id)

  /*
   * Un equipo PROPIO se marca en la semana pero JAMÁS genera pago.
   *
   * Desde que el bloque muestra propios y rentados juntos, marcar días de una
   * máquina nuestra podría fabricar una liquidación —y una transferencia— por
   * algo que ya es de la casa. A14, BR-245.
   */
  const propio = await prisma.equipment.create({
    data: {
      companyId: PREFIX, code: 'FE-PROPIO', name: 'Camion Propio',
      ownership: 'OWNED', dailyCost: '300.00', vendorId: vendorRow.id,
    },
  })
  const projectPropio = await prisma.project.create({
    data: { companyId: PREFIX, code: 'FLOW-OBRA-PROPIO', name: 'Obra del equipo propio' },
  })
  await prisma.equipmentEntry.createMany({
    data: ['2026-07-20', '2026-07-21'].map((d) => ({
      companyId: PREFIX, payrollWeekId: week.id, equipmentId: propio.id,
      workDate: new Date(`${d}T00:00:00Z`), projectId: projectPropio.id,
    })),
  })
  await syncEquipmentPayrolls(PREFIX, week.id)
  check('un equipo PROPIO se marca pero nunca genera liquidación de pago',
    (await prisma.equipmentPayroll.count({ where: { equipmentId: propio.id } })) === 0)
  check('sus días sí quedan anotados, con el proyecto al que fue',
    (await prisma.equipmentEntry.count({
      where: { equipmentId: propio.id, projectId: projectPropio.id },
    })) === 2)

  // Un equipo SIN costo diario: bloquea con error crítico, jamás paga $0.
  const sinCosto = await prisma.equipment.create({
    data: { companyId: PREFIX, code: 'FE2', name: 'Plow Flow', ownership: 'RENTED', vendorId: vendorRow.id },
  })
  await prisma.equipmentEntry.create({
    data: {
      companyId: PREFIX, payrollWeekId: week.id, equipmentId: sinCosto.id,
      workDate: new Date('2026-07-20T00:00:00Z'),
    },
  })
  await syncEquipmentPayrolls(PREFIX, week.id)
  const sinCostoPayable = await prisma.equipmentPayroll.findUniqueOrThrow({
    where: {
      companyId_payrollWeekId_equipmentId: {
        companyId: PREFIX, payrollWeekId: week.id, equipmentId: sinCosto.id,
      },
    },
  })
  await applyPayableTransition(leo, 'EQUIPMENT', [sinCostoPayable.id], 'SUBMIT')
  await assignRecipientToPayables(
    rafael, { equipmentPayrollIds: [sinCostoPayable.id] }, recipient.recipientId!,
  )
  const sinCostoApprove = await applyPayableTransition(rafael, 'EQUIPMENT', [sinCostoPayable.id], 'APPROVE')
  check('sin costo diario NO se aprueba: jamás se paga $0.00 en silencio',
    sinCostoApprove.moved === 0 && (sinCostoApprove.skipped[0]?.reason ?? '').includes('aviso'),
    sinCostoApprove.skipped[0]?.reason)

  // ── 14. La misma persona, dos proyectos en la misma semana
  console.log('\n14. Dos proyectos en la misma semana')
  const dublin = await prisma.project.create({
    data: { companyId: PREFIX, code: 'FLOW-DUBLIN', name: 'Dublin GA' },
  })
  const homer = await prisma.project.create({
    data: { companyId: PREFIX, code: 'FLOW-HOMER', name: 'Homer GA' },
  })
  const viajero = await prisma.worker.create({
    data: {
      companyId: PREFIX, code: 'FW5', firstName: 'Isaac', lastName: 'Viajero',
      displayName: 'Isaac Viajero', defaultOperationId: operation.id,
    },
  })
  await prisma.workerRate.create({
    data: {
      companyId: PREFIX, workerId: viajero.id, rateType: 'DAILY', amount: '150.00',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'), operationId: operation.id,
    },
  })

  // Lunes, martes y viernes en Dublin; miércoles y jueves en Homer. Pasa.
  for (const [day, projectId] of [
    ['2026-07-19', dublin.id], ['2026-07-20', dublin.id],
    ['2026-07-21', homer.id], ['2026-07-22', homer.id],
    ['2026-07-23', dublin.id],
  ] as const) {
    await prisma.workEntry.create({
      data: {
        companyId: PREFIX, payrollWeekId: week.id, workerId: viajero.id,
        workDate: new Date(`${day}T00:00:00Z`), dayType: 'FULL_DAY',
        operationId: operation.id, projectId,
      },
    })
  }

  const mixedEntries = await prisma.workEntry.findMany({
    where: { payrollWeekId: week.id, workerId: viajero.id },
    orderBy: { workDate: 'asc' },
  })
  const mixedRates = await prisma.workerRate.findMany({ where: { workerId: viajero.id } })
  const mixedResult = calculateWorkerPayroll({
    workerId: viajero.id,
    compensationType: 'DAILY_RATE',
    fixedWeeklyAmount: null,
    entries: mixedEntries.map((entry) => ({
      id: entry.id,
      workDate: entry.workDate.toISOString().slice(0, 10),
      dayType: entry.dayType,
      hoursWorked: null,
      shift: entry.shift,
      projectId: entry.projectId,
      crewId: entry.crewId,
      operationId: entry.operationId,
    })),
    rates: mixedRates.map((rate) => ({
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

  check('5 días × $150 = $750 aunque cambie de proyecto a mitad de semana',
    toDecimalString(mixedResult.netPay) === '750.00', toDecimalString(mixedResult.netPay))

  const porProyecto = new Map<string, number>()
  for (const line of mixedResult.lines) {
    if (!line.projectId) continue
    porProyecto.set(line.projectId, (porProyecto.get(line.projectId) ?? 0) + 1)
  }
  check('cada día se queda en SU proyecto: 3 en Dublin, 2 en Homer',
    porProyecto.get(dublin.id) === 3 && porProyecto.get(homer.id) === 2,
    `dublin=${porProyecto.get(dublin.id) ?? 0} homer=${porProyecto.get(homer.id) ?? 0}`)

  const mixedPayroll = await prisma.workerPayroll.create({
    data: {
      companyId: PREFIX, payrollWeekId: week.id, workerId: viajero.id, status: 'PREPARED',
      daysFull: mixedResult.daysFull, basePay: toDecimalString(mixedResult.basePay),
      grossPay: toDecimalString(mixedResult.grossPay), netPay: toDecimalString(mixedResult.netPay),
    },
  })
  await prisma.payrollLine.createMany({
    data: mixedResult.lines.map((line) => ({
      workerPayrollId: mixedPayroll.id,
      workEntryId: line.workEntryId,
      lineType: line.lineType,
      workDate: line.workDate ? new Date(`${line.workDate}T00:00:00Z`) : null,
      quantity: line.quantity,
      appliedRate: toDecimalString(line.appliedRate),
      rateSourceId: line.rateSourceId,
      amount: toDecimalString(line.amount),
      projectId: line.projectId,
      crewId: line.crewId,
      shift: line.shift,
      description: line.description,
    })),
  })

  await applyTransition(leo, [mixedPayroll.id], 'SUBMIT')
  await assignRecipient(rafael, [mixedPayroll.id], recipient.recipientId!)
  const mixedApproved = await applyTransition(rafael, [mixedPayroll.id], 'APPROVE')
  check('la semana repartida se aprueba igual que cualquier otra',
    mixedApproved.moved === 1, mixedApproved.skipped[0]?.reason)

  /*
   * Mover un día de un proyecto a otro no cambia un centavo del pago… y aun así
   * tumba la aprobación. Cambia a quién se le factura ese día, que es
   * exactamente el tipo de cambio silencioso que este sistema existe para
   * impedir.
   */
  const miercoles = mixedEntries.find(
    (entry) => entry.workDate.toISOString().slice(0, 10) === '2026-07-21',
  )!
  await prisma.workEntry.update({ where: { id: miercoles.id }, data: { projectId: dublin.id } })
  const projectStale = await invalidateIfStale(mixedPayroll.id)
  const afterProject = await prisma.workerPayroll.findUniqueOrThrow({
    where: { id: mixedPayroll.id },
  })
  check('cambiar el proyecto de un día tumba la aprobación, aunque el monto no cambie',
    projectStale && afterProject.status === 'PENDING_APPROVAL', afterProject.status)
  check('y el neto sigue siendo el mismo: lo que cambió fue a quién se le cobra',
    afterProject.netPay.toFixed(2) === '750.00', afterProject.netPay.toFixed(2))

  // ── 15. Dónde se para la pantalla de entrada
  console.log('\n15. La pantalla de entrada')
  const focus = await weekFocus(PREFIX)
  check('se para en la semana donde está el trabajo, no en la del calendario',
    focus.weekId === week.id, `${focus.label} (hoy es otra semana)`)
  check('cuenta los tres pagables juntos, no solo personas',
    focus.calculated >= 3, `${focus.calculated} liquidación(es)`)
  check('ve lo que está esperando aprobación',
    focus.pendingApproval >= 2, String(focus.pendingApproval))
  check('ve lo que ya se pagó', focus.paid >= 3, String(focus.paid))

  const pendientes = await pendingBoard(PREFIX, '2026-07-19')
  check('el tablero de pendientes avisa del equipo sin costo diario',
    pendientes.some((item) => item.key === 'equipos'),
    pendientes.map((item) => item.key).join(', ') || 'ninguno')

  // ── 16. Devolver un renglón a aprobación desde la orden
  console.log('\n16. Devolver a aprobación desde la orden')
  const week31 = await prisma.payrollWeek.create({
    data: {
      companyId: PREFIX, year: 2026, weekNumber: 31,
      startDate: new Date('2026-07-26T00:00:00Z'),
      endDate: new Date('2026-08-01T00:00:00Z'),
      label: 'Semana 31',
    },
  })
  await prisma.production.create({
    data: {
      companyId: PREFIX, payrollWeekId: week31.id, crewId: crew.id,
      productionDate: new Date('2026-07-28T00:00:00Z'),
      unitCode: 'FIBER', unitLabel: 'Fibra', quantity: '2000.00',
      appliedPrice: '0.5', amount: '1000.00',
    },
  })
  await syncCrewPayrolls(PREFIX, week31.id)
  const devuelta = await prisma.crewPayroll.findUniqueOrThrow({
    where: {
      companyId_payrollWeekId_crewId: {
        companyId: PREFIX, payrollWeekId: week31.id, crewId: crew.id,
      },
    },
  })
  await applyPayableTransition(leo, 'CREW', [devuelta.id], 'SUBMIT')
  await assignRecipientToPayables(rafael, { crewPayrollIds: [devuelta.id] }, recipient.recipientId!)
  await applyPayableTransition(rafael, 'CREW', [devuelta.id], 'APPROVE')
  const ordenNueva = await generateOrders(rafael, { crewPayrollIds: [devuelta.id] })
  check('se genera la orden de la semana 31', ordenNueva.ok, ordenNueva.message)
  const itemNuevo = await prisma.disbursementOrderItem.findUniqueOrThrow({
    where: { crewPayrollId: devuelta.id },
    include: { order: true },
  })

  const returned = await applyPayableTransition(
    tesoreria, 'CREW', [devuelta.id], 'RETURN', 'La producción estaba mal medida',
  )
  check('tesorería devuelve un renglón que todavía no se ha pagado',
    returned.moved === 1, returned.skipped[0]?.reason)
  const afterReturn = await prisma.crewPayroll.findUniqueOrThrow({ where: { id: devuelta.id } })
  check('la liquidación vuelve a la mesa de quien aprueba',
    afterReturn.status === 'PENDING_APPROVAL', afterReturn.status)
  check('el renglón sale de la orden',
    (await prisma.disbursementOrderItem.findUnique({ where: { crewPayrollId: devuelta.id } })) === null)
  const orderAfter = await prisma.disbursementOrder.findUniqueOrThrow({
    where: { id: itemNuevo.order.id },
  })
  check('la orden que se queda sin renglones se anula sola (BR-191)',
    orderAfter.status === 'CANCELLED', orderAfter.status)

  await cleanup()

  console.log(`\n${passed}/${passed + failed} comprobaciones correctas`)
  if (failed > 0) process.exitCode = 1
}

await main()
await prisma.$disconnect()
