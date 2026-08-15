/**
 * Órdenes de desembolso, contra la base real.
 *
 * Aquí se prueba lo que mueve dinero: que no se pueda aprobar sin decir a
 * dónde va, que las órdenes cuadren con lo aprobado, que un consecutivo no se
 * repita, y que una orden pagada no se pueda modificar por debajo.
 */
import 'dotenv/config'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import type { CurrentUser } from '@/lib/auth/rbac'
import { databaseUrl } from '@/lib/db/url'
import {
  assignRecipient,
  cancelOrder,
  generateOrders,
  payOrder,
  previewApproval,
} from '@/lib/disbursement/orders'
import { createRecipient, setRecipientActive } from '@/lib/disbursement/recipients'
import { formatOrderNumber, nextNumber } from '@/lib/disbursement/sequence'
import { applyTransition } from '@/lib/payroll/workflow/service'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) })

const COMPANY = 'test-disb-company'
const WEEK = 'test-disb-week'
const PREPARER = 'test-disb-preparer'
const APPROVER = 'test-disb-approver'
const TREASURY = 'test-disb-treasury'

const PERMISSIONS = new Set([
  'payroll:view',
  'payroll:edit',
  'payroll:submit',
  'payroll:approve',
  'payroll:reject',
  'payroll:return',
  'payment:view',
  'payment:execute',
  'payment:proof:upload',
])

function actor(id: string, name: string): CurrentUser {
  return {
    id,
    name,
    email: `${id}@test`,
    companyId: COMPANY,
    companyCode: 'TEST_DISB',
    companyName: 'Prueba',
    roleCodes: [],
    permissions: PERMISSIONS,
    availableCompanies: [],
  }
}

const approver = actor(APPROVER, 'Quien aprueba')
const treasury = actor(TREASURY, 'Tesorería')

async function cleanup() {
  await prisma.$executeRawUnsafe('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_delete')
  await prisma.$executeRawUnsafe(
    'ALTER TABLE disbursement_order DISABLE TRIGGER disbursement_order_immutable',
  )
  await prisma.$executeRawUnsafe(
    'ALTER TABLE disbursement_order_item DISABLE TRIGGER disbursement_item_immutable',
  )
  await prisma.$executeRawUnsafe(
    'ALTER TABLE payment_recipient DISABLE TRIGGER payment_recipient_keep_history',
  )
  await prisma.$executeRawUnsafe(
    'ALTER TABLE worker_payroll DISABLE TRIGGER worker_payroll_immutable',
  )
  try {
    await prisma.auditLog.deleteMany({ where: { companyId: COMPANY } })
    await prisma.disbursementDocument.deleteMany({ where: { companyId: COMPANY } })
    await prisma.disbursementOrderItem.deleteMany({ where: { companyId: COMPANY } })
    await prisma.disbursementOrder.deleteMany({ where: { companyId: COMPANY } })
    await prisma.payment.deleteMany({ where: { companyId: COMPANY } })
    await prisma.workerPayroll.deleteMany({ where: { companyId: COMPANY } })
    await prisma.paymentRecipient.deleteMany({ where: { companyId: COMPANY } })
    await prisma.payrollWeek.deleteMany({ where: { companyId: COMPANY } })
    await prisma.worker.deleteMany({ where: { companyId: COMPANY } })
    await prisma.company.deleteMany({ where: { id: COMPANY } })
    await prisma.$executeRawUnsafe('DELETE FROM document_sequence WHERE "companyId" = $1', COMPANY)
    for (const id of [PREPARER, APPROVER, TREASURY]) {
      await prisma.user.deleteMany({ where: { id } })
    }
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_delete')
    await prisma.$executeRawUnsafe(
      'ALTER TABLE disbursement_order ENABLE TRIGGER disbursement_order_immutable',
    )
    await prisma.$executeRawUnsafe(
      'ALTER TABLE disbursement_order_item ENABLE TRIGGER disbursement_item_immutable',
    )
    await prisma.$executeRawUnsafe(
      'ALTER TABLE payment_recipient ENABLE TRIGGER payment_recipient_keep_history',
    )
    await prisma.$executeRawUnsafe(
      'ALTER TABLE worker_payroll ENABLE TRIGGER worker_payroll_immutable',
    )
  }
}

/** Contador propio: una prueba puede sembrar gente más de una vez. */
let sequence = 0

/** Nóminas listas para aprobar, con los netos que se le pasen. */
async function seedPayrolls(nets: readonly string[]): Promise<string[]> {
  const ids: string[] = []
  for (const net of nets) {
    sequence += 1
    const index = sequence
    const worker = await prisma.worker.create({
      data: {
        companyId: COMPANY,
        code: `DW${index}`,
        firstName: `Persona`,
        lastName: String(index),
        displayName: `Persona ${index}`,
      },
    })
    const payroll = await prisma.workerPayroll.create({
      data: {
        companyId: COMPANY,
        payrollWeekId: WEEK,
        workerId: worker.id,
        status: 'PENDING_APPROVAL',
        daysFull: 5,
        basePay: net,
        grossPay: net,
        netPay: net,
        preparedById: PREPARER,
        preparedAt: new Date(),
      },
    })
    ids.push(payroll.id)
  }
  return ids
}

beforeEach(async () => {
  await cleanup()
  await prisma.company.create({
    data: { id: COMPANY, code: 'TEST_DISB', legalName: 'Prueba', displayName: 'Prueba' },
  })
  await prisma.payrollWeek.create({
    data: {
      id: WEEK,
      companyId: COMPANY,
      year: 2026,
      weekNumber: 98,
      startDate: new Date('2026-05-03T00:00:00Z'),
      endDate: new Date('2026-05-09T00:00:00Z'),
      label: 'Semana 98',
    },
  })
  for (const [id, name] of [
    [PREPARER, 'Quien prepara'],
    [APPROVER, 'Quien aprueba'],
    [TREASURY, 'Tesorería'],
  ] as const) {
    await prisma.user.create({ data: { id, email: `${id}@test`, name } })
  }
})

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function newRecipient(name: string): Promise<string> {
  const result = await createRecipient(approver, { name })
  expect(result.ok).toBe(true)
  return result.recipientId!
}

// ─────────────────────────────────────────────────────────────

describe('asignar la empresa receptora', () => {
  it('asigna a varias personas de una sola vez', async () => {
    const ids = await seedPayrolls(['100.00', '200.00', '300.00'])
    const recipient = await newRecipient('Receptora Uno')

    const result = await assignRecipient(approver, ids, recipient)

    expect(result.ok).toBe(true)
    expect(result.assigned).toBe(3)
    expect(
      await prisma.workerPayroll.count({
        where: { companyId: COMPANY, paymentRecipientId: recipient },
      }),
    ).toBe(3)
  })

  it('deja cambiar de receptora mientras no esté aprobada', async () => {
    const ids = await seedPayrolls(['100.00'])
    const first = await newRecipient('Receptora Uno')
    const second = await newRecipient('Receptora Dos')

    await assignRecipient(approver, ids, first)
    await assignRecipient(approver, ids, second)

    const payroll = await prisma.workerPayroll.findUniqueOrThrow({ where: { id: ids[0]! } })
    expect(payroll.paymentRecipientId).toBe(second)
  })

  it('no acepta una receptora inactiva', async () => {
    const ids = await seedPayrolls(['100.00'])
    const recipient = await newRecipient('Receptora Uno')
    await setRecipientActive(approver, recipient, false)

    const result = await assignRecipient(approver, ids, recipient)

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/inactiva/i)
  })

  it('no acepta una receptora de otra compañía', async () => {
    const ids = await seedPayrolls(['100.00'])
    const result = await assignRecipient(approver, ids, 'no-existe')
    expect(result.ok).toBe(false)
  })

  it('deja constancia de quién asignó y cuándo', async () => {
    const ids = await seedPayrolls(['100.00'])
    const recipient = await newRecipient('Receptora Uno')
    await assignRecipient(approver, ids, recipient)

    const payroll = await prisma.workerPayroll.findUniqueOrThrow({ where: { id: ids[0]! } })
    expect(payroll.recipientAssignedById).toBe(APPROVER)
    expect(payroll.recipientAssignedAt).not.toBeNull()

    const log = await prisma.auditLog.findFirst({
      where: { companyId: COMPANY, action: 'RECIPIENT_ASSIGNED' },
    })
    expect(log?.reason).toContain('Receptora Uno')
  })
})

describe('no se aprueba sin decir a dónde va el dinero', () => {
  it('bloquea la aprobación de quien no tiene receptora', async () => {
    const ids = await seedPayrolls(['100.00'])

    const result = await applyTransition(approver, ids, 'APPROVE', null)

    expect(result.moved).toBe(0)
    expect(result.skipped[0]?.reason).toMatch(/empresa receptora/i)
    const payroll = await prisma.workerPayroll.findUniqueOrThrow({ where: { id: ids[0]! } })
    expect(payroll.status).toBe('PENDING_APPROVAL')
  })

  it('aprueba las que sí la tienen y deja fuera a las que no', async () => {
    const ids = await seedPayrolls(['100.00', '200.00'])
    const recipient = await newRecipient('Receptora Uno')
    await assignRecipient(approver, [ids[0]!], recipient)

    const result = await applyTransition(approver, ids, 'APPROVE', null)

    expect(result.moved).toBe(1)
    expect(result.skipped).toHaveLength(1)
  })

  it('el resumen previo avisa de quiénes faltan y no cuadra', async () => {
    const ids = await seedPayrolls(['100.00', '200.00'])
    const recipient = await newRecipient('Receptora Uno')
    await assignRecipient(approver, [ids[0]!], recipient)

    const preview = await previewApproval(COMPANY, ids)

    expect(preview.balanced).toBe(false)
    expect(preview.unassigned).toHaveLength(1)
    expect(preview.balanceMessage).toMatch(/no tienen empresa receptora/i)
  })

  it('cuando están todas asignadas, el resumen cuadra con lo aprobado', async () => {
    const ids = await seedPayrolls(['100.00', '250.50'])
    const recipient = await newRecipient('Receptora Uno')
    await assignRecipient(approver, ids, recipient)

    const preview = await previewApproval(COMPANY, ids)

    expect(preview.balanced).toBe(true)
    expect(preview.grandTotal).toBe('350.50')
    expect(preview.groups).toHaveLength(1)
    expect(preview.groups[0]!.workers).toHaveLength(2)
  })
})

describe('generar las órdenes', () => {
  async function approveAll(nets: readonly string[], split?: readonly number[]) {
    const ids = await seedPayrolls(nets)
    const one = await newRecipient('Receptora Uno')
    const two = await newRecipient('Receptora Dos')

    if (split) {
      await assignRecipient(approver, split.map((index) => ids[index]!), two)
      await assignRecipient(
        approver,
        ids.filter((_, index) => !split.includes(index)),
        one,
      )
    } else {
      await assignRecipient(approver, ids, one)
    }

    await applyTransition(approver, ids, 'APPROVE', null)
    return { ids, one, two }
  }

  it('una receptora produce una orden con el total exacto', async () => {
    const { ids } = await approveAll(['100.00', '250.50'])
    const result = await generateOrders(approver, ids)

    expect(result.ok).toBe(true)
    const orders = await prisma.disbursementOrder.findMany({
      where: { companyId: COMPANY },
      include: { items: true },
    })
    expect(orders).toHaveLength(1)
    expect(orders[0]!.totalAmount.toFixed(2)).toBe('350.50')
    expect(orders[0]!.itemCount).toBe(2)
    expect(orders[0]!.items).toHaveLength(2)
  })

  it('dos receptoras producen dos órdenes, y juntas dan el total aprobado', async () => {
    const { ids } = await approveAll(['100.00', '200.00', '300.00'], [2])
    await generateOrders(approver, ids)

    const orders = await prisma.disbursementOrder.findMany({ where: { companyId: COMPANY } })
    expect(orders).toHaveLength(2)

    const sum = orders.reduce((total, order) => total + Number(order.totalAmount), 0)
    expect(sum.toFixed(2)).toBe('600.00')
  })

  it('cada orden lleva un consecutivo distinto', async () => {
    const { ids } = await approveAll(['100.00', '200.00'], [1])
    await generateOrders(approver, ids)

    const orders = await prisma.disbursementOrder.findMany({ where: { companyId: COMPANY } })
    const numbers = orders.map((order) => order.orderNumber)
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(numbers[0]).toMatch(/^OD-TEST_DISB-2026-\d{4}$/)
  })

  it('generar dos veces no duplica nada', async () => {
    const { ids } = await approveAll(['100.00'])
    await generateOrders(approver, ids)
    const second = await generateOrders(approver, ids)

    expect(second.orderNumbers).toEqual([])
    expect(await prisma.disbursementOrder.count({ where: { companyId: COMPANY } })).toBe(1)
    expect(await prisma.disbursementOrderItem.count({ where: { companyId: COMPANY } })).toBe(1)
  })

  it('congela los nombres para que el documento no cambie después', async () => {
    const { ids, one } = await approveAll(['100.00'])
    await generateOrders(approver, ids)

    await prisma.paymentRecipient.update({
      where: { id: one },
      data: { name: 'Nombre Cambiado Después' },
    })

    const order = await prisma.disbursementOrder.findFirstOrThrow({ where: { companyId: COMPANY } })
    expect(order.recipientNameSnapshot).toBe('Receptora Uno')
    expect(order.companyNameSnapshot).toBe('Prueba')
    expect(order.weekLabelSnapshot).toContain('Semana 98')
  })

  it('guarda quién preparó y quién aprobó', async () => {
    const { ids } = await approveAll(['100.00'])
    await generateOrders(approver, ids)

    const order = await prisma.disbursementOrder.findFirstOrThrow({ where: { companyId: COMPANY } })
    expect(order.preparedByName).toBe('Quien prepara')
    expect(order.approvedByName).toBe('Quien aprueba')
    expect(order.approvedById).toBe(APPROVER)
  })

  it('el consecutivo no se repite ni pidiéndolo a la vez', async () => {
    const numbers = await Promise.all(
      Array.from({ length: 12 }, () => nextNumber(COMPANY, 'DISBURSEMENT_ORDER', 2026)),
    )
    expect(new Set(numbers).size).toBe(12)
    expect(formatOrderNumber('TEST', 2026, 7)).toBe('OD-TEST-2026-0007')
  })
})

describe('registrar el pago', () => {
  async function readyOrder(nets: readonly string[] = ['100.00', '200.00']) {
    const ids = await seedPayrolls(nets)
    const recipient = await newRecipient('Receptora Uno')
    await assignRecipient(approver, ids, recipient)
    await applyTransition(approver, ids, 'APPROVE', null)
    await generateOrders(approver, ids)
    const order = await prisma.disbursementOrder.findFirstOrThrow({
      where: { companyId: COMPANY },
      include: { items: true },
    })
    return { ids, order }
  }

  const base = {
    paymentDate: '2026-05-12',
    method: 'WIRE' as const,
    reference: 'REF-1',
  }

  it('paga la orden completa y crea un pago por trabajador', async () => {
    const { order } = await readyOrder()

    const result = await payOrder(treasury, { ...base, orderId: order.id, amountPaid: '300.00' })

    expect(result.ok).toBe(true)
    const after = await prisma.disbursementOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(after.status).toBe('PAID')
    expect(after.amountPaid.toFixed(2)).toBe('300.00')
    expect(await prisma.payment.count({ where: { disbursementOrderId: order.id } })).toBe(2)

    const payrolls = await prisma.workerPayroll.findMany({ where: { companyId: COMPANY } })
    expect(payrolls.every((payroll) => payroll.status === 'PAID')).toBe(true)
  })

  it('rechaza un monto que no coincide con quienes se marcaron', async () => {
    const { order } = await readyOrder()

    const result = await payOrder(treasury, { ...base, orderId: order.id, amountPaid: '250.00' })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('300.00')
    expect(result.message).toContain('250.00')
    // Nada quedó a medias.
    expect(await prisma.payment.count({ where: { companyId: COMPANY } })).toBe(0)
    const after = await prisma.disbursementOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(after.status).toBe('PENDING_PAYMENT')
  })

  it('un giro parcial exige explicación', async () => {
    const { order } = await readyOrder()
    const first = order.items[0]!

    const result = await payOrder(treasury, {
      ...base,
      orderId: order.id,
      amountPaid: first.amount.toFixed(2),
      workerPayrollIds: [first.workerPayrollId!],
    })

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/por qué van aparte/i)
  })

  it('con explicación, el giro parcial se registra y el resto queda pendiente', async () => {
    const { order } = await readyOrder()
    const first = order.items[0]!

    const result = await payOrder(treasury, {
      ...base,
      orderId: order.id,
      amountPaid: first.amount.toFixed(2),
      workerPayrollIds: [first.workerPayrollId!],
      differenceReason: 'El segundo giro sale mañana',
    })

    expect(result.ok).toBe(true)
    const after = await prisma.disbursementOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(after.status).toBe('PARTIALLY_PAID')

    const paid = await prisma.workerPayroll.findUniqueOrThrow({
      where: { id: first.workerPayrollId! },
    })
    expect(paid.status).toBe('PAID')

    const rest = await prisma.workerPayroll.findMany({
      where: { companyId: COMPANY, NOT: { id: first.workerPayrollId! } },
    })
    expect(rest.every((payroll) => payroll.status === 'APPROVED')).toBe(true)
  })

  it('el segundo giro cierra la orden', async () => {
    const { order } = await readyOrder()
    const [first, second] = order.items

    await payOrder(treasury, {
      ...base,
      orderId: order.id,
      amountPaid: first!.amount.toFixed(2),
      workerPayrollIds: [first!.workerPayrollId!],
      differenceReason: 'primer giro',
    })
    const result = await payOrder(treasury, {
      ...base,
      reference: 'REF-2',
      orderId: order.id,
      amountPaid: second!.amount.toFixed(2),
      workerPayrollIds: [second!.workerPayrollId!],
      differenceReason: 'segundo giro',
    })

    expect(result.ok).toBe(true)
    const after = await prisma.disbursementOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(after.status).toBe('PAID')
    expect(after.amountPaid.toFixed(2)).toBe('300.00')
  })

  it('una referencia ya usada en otra orden se rechaza', async () => {
    const { order } = await readyOrder(['100.00'])
    await payOrder(treasury, { ...base, orderId: order.id, amountPaid: '100.00' })

    const otherIds = await seedPayrolls(['50.00'])
    const other = await newRecipient('Receptora Dos')
    await assignRecipient(approver, otherIds, other)
    await applyTransition(approver, otherIds, 'APPROVE', null)
    await generateOrders(approver, otherIds)
    const second = await prisma.disbursementOrder.findFirstOrThrow({
      where: { companyId: COMPANY, NOT: { id: order.id } },
    })

    const result = await payOrder(treasury, { ...base, orderId: second.id, amountPaid: '50.00' })

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/referencia ya se us/i)
  })

  it('no se paga dos veces la misma orden', async () => {
    const { order } = await readyOrder(['100.00'])
    await payOrder(treasury, { ...base, orderId: order.id, amountPaid: '100.00' })

    const again = await payOrder(treasury, {
      ...base,
      reference: 'REF-9',
      orderId: order.id,
      amountPaid: '100.00',
    })

    expect(again.ok).toBe(false)
    expect(again.message).toMatch(/ya está pagada/i)
  })

  it('quien aprobó no puede pagar', async () => {
    const { order } = await readyOrder(['100.00'])

    const result = await payOrder(approver, { ...base, orderId: order.id, amountPaid: '100.00' })

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/tú mismo aprobaste/i)
    expect(await prisma.payment.count({ where: { companyId: COMPANY } })).toBe(0)
  })

  it('el pago queda en el registro de auditoría con el detalle', async () => {
    const { order } = await readyOrder(['100.00'])
    await payOrder(treasury, { ...base, orderId: order.id, amountPaid: '100.00' })

    const log = await prisma.auditLog.findFirst({
      where: { companyId: COMPANY, action: 'DISBURSEMENT_PAID' },
    })
    expect(log).not.toBeNull()
    expect(JSON.stringify(log?.newValueJson)).toContain('REF-1')
    expect(log?.userId).toBe(TREASURY)
  })
})

describe('lo que la base impide aunque el código falle', () => {
  async function paidOrder() {
    const ids = await seedPayrolls(['100.00'])
    const recipient = await newRecipient('Receptora Uno')
    await assignRecipient(approver, ids, recipient)
    await applyTransition(approver, ids, 'APPROVE', null)
    await generateOrders(approver, ids)
    const order = await prisma.disbursementOrder.findFirstOrThrow({ where: { companyId: COMPANY } })
    await payOrder(treasury, {
      orderId: order.id,
      paymentDate: '2026-05-12',
      method: 'WIRE',
      reference: 'REF-PAID',
      amountPaid: '100.00',
    })
    return { order, recipient }
  }

  it('no se le cambia el monto a una orden pagada', async () => {
    const { order } = await paidOrder()

    await expect(
      prisma.disbursementOrder.update({
        where: { id: order.id },
        data: { totalAmount: '999.00' },
      }),
    ).rejects.toThrow(/no se puede modificar/i)
  })

  it('no se le cambia la referencia bancaria a una orden pagada', async () => {
    const { order } = await paidOrder()

    await expect(
      prisma.disbursementOrder.update({ where: { id: order.id }, data: { reference: 'OTRA' } }),
    ).rejects.toThrow(/no se puede modificar/i)
  })

  it('no se borra una orden con dinero desembolsado', async () => {
    const { order } = await paidOrder()

    await expect(
      prisma.disbursementOrder.delete({ where: { id: order.id } }),
    ).rejects.toThrow(/no se puede borrar/i)

    // Y sigue ahí: el borrado no se canceló en silencio.
    expect(
      await prisma.disbursementOrder.count({ where: { id: order.id } }),
    ).toBe(1)
  })

  it('no se tocan los renglones de una orden pagada', async () => {
    const { order } = await paidOrder()
    const item = await prisma.disbursementOrderItem.findFirstOrThrow({
      where: { disbursementOrderId: order.id },
    })

    await expect(
      prisma.disbursementOrderItem.update({ where: { id: item.id }, data: { amount: '1.00' } }),
    ).rejects.toThrow(/no se pueden cambiar/i)
  })

  it('no se borra una receptora con historial: se desactiva', async () => {
    const { recipient } = await paidOrder()

    await expect(
      prisma.paymentRecipient.delete({ where: { id: recipient } }),
    ).rejects.toThrow(/No se borra/i)

    const result = await setRecipientActive(approver, recipient, false)
    expect(result.ok).toBe(true)
    expect(
      (await prisma.paymentRecipient.findUniqueOrThrow({ where: { id: recipient } })).active,
    ).toBe(false)
  })

  it('no se puede pagar más de lo aprobado', async () => {
    const ids = await seedPayrolls(['100.00'])
    const recipient = await newRecipient('Receptora Uno')
    await assignRecipient(approver, ids, recipient)
    await applyTransition(approver, ids, 'APPROVE', null)
    await generateOrders(approver, ids)
    const order = await prisma.disbursementOrder.findFirstOrThrow({ where: { companyId: COMPANY } })

    await expect(
      prisma.disbursementOrder.update({
        where: { id: order.id },
        data: { amountPaid: '500.00' },
      }),
    ).rejects.toThrow()
  })
})

describe('devolver una nómina que ya está en una orden', () => {
  async function orderWith(nets: readonly string[]) {
    const ids = await seedPayrolls(nets)
    const recipient = await newRecipient('Receptora Uno')
    await assignRecipient(approver, ids, recipient)
    await applyTransition(approver, ids, 'APPROVE', null)
    await generateOrders(approver, ids)
    const order = await prisma.disbursementOrder.findFirstOrThrow({
      where: { companyId: COMPANY },
      include: { items: true },
    })
    return { ids, order }
  }

  it('sale de la orden y el total se recalcula', async () => {
    const { ids, order } = await orderWith(['100.00', '200.00'])
    expect(order.totalAmount.toFixed(2)).toBe('300.00')

    const result = await applyTransition(approver, [ids[0]!], 'RETURN', 'Faltó un día')

    expect(result.moved).toBe(1)
    const after = await prisma.disbursementOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(after.totalAmount.toFixed(2)).toBe('200.00')
    expect(after.itemCount).toBe(1)
    expect(
      await prisma.disbursementOrderItem.count({ where: { workerPayrollId: ids[0]! } }),
    ).toBe(0)
  })

  it('si la orden se queda vacía, se anula con el motivo', async () => {
    const { ids, order } = await orderWith(['100.00'])

    await applyTransition(approver, ids, 'RETURN', 'Se equivocaron de persona')

    const after = await prisma.disbursementOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(after.status).toBe('CANCELLED')
    expect(after.cancellationReason).toContain('Se equivocaron de persona')
    expect(after.totalAmount.toFixed(2)).toBe('0.00')
  })

  it('NO se devuelve si la orden ya movió dinero', async () => {
    const { ids, order } = await orderWith(['100.00'])
    await payOrder(treasury, {
      orderId: order.id,
      paymentDate: '2026-05-12',
      method: 'WIRE',
      reference: 'REF-MOVIDO',
      amountPaid: '100.00',
    })

    const result = await applyTransition(approver, ids, 'RETURN', 'Ya no')

    expect(result.moved).toBe(0)
    // Al estar pagada ni siquiera es un estado del que se pueda devolver.
    expect(result.skipped[0]?.reason).toBeTruthy()
    const after = await prisma.disbursementOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(after.totalAmount.toFixed(2)).toBe('100.00')
  })

  it('con un giro a medias, quien no cobró tampoco se devuelve solo', async () => {
    const { ids, order } = await orderWith(['100.00', '200.00'])
    const first = order.items[0]!

    await payOrder(treasury, {
      orderId: order.id,
      paymentDate: '2026-05-12',
      method: 'WIRE',
      reference: 'REF-PARCIAL',
      amountPaid: first.amount.toFixed(2),
      workerPayrollIds: [first.workerPayrollId!],
      differenceReason: 'primer giro',
    })

    const other = ids.find((id) => id !== first.workerPayrollId)!
    const result = await applyTransition(approver, [other], 'RETURN', 'Faltó un día')

    expect(result.moved).toBe(0)
    expect(result.skipped[0]?.reason).toMatch(/dinero desembolsado/i)
    const after = await prisma.disbursementOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(after.totalAmount.toFixed(2)).toBe('300.00')
  })

  it('volver a aprobar tras devolver genera una orden con el monto nuevo', async () => {
    const { ids, order } = await orderWith(['100.00', '200.00'])
    await applyTransition(approver, [ids[0]!], 'RETURN', 'Faltó un día')

    // Se corrige el neto y se vuelve a enviar y aprobar.
    await prisma.workerPayroll.update({
      where: { id: ids[0]! },
      data: { status: 'PENDING_APPROVAL', netPay: '150.00' },
    })
    await applyTransition(approver, [ids[0]!], 'APPROVE', null)
    await generateOrders(approver, [ids[0]!])

    const reopened = await prisma.disbursementOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    })
    // Vuelve a la misma orden abierta, ahora con el monto corregido.
    expect(reopened.totalAmount.toFixed(2)).toBe('350.00')
    expect(reopened.items).toHaveLength(2)
  })
})

describe('anular una orden', () => {
  it('se anula solo con motivo, y solo si no ha salido dinero', async () => {
    const ids = await seedPayrolls(['100.00'])
    const recipient = await newRecipient('Receptora Uno')
    await assignRecipient(approver, ids, recipient)
    await applyTransition(approver, ids, 'APPROVE', null)
    await generateOrders(approver, ids)
    const order = await prisma.disbursementOrder.findFirstOrThrow({ where: { companyId: COMPANY } })

    expect((await cancelOrder(approver, order.id, '  ')).ok).toBe(false)

    const result = await cancelOrder(approver, order.id, 'Se repitió la orden')
    expect(result.ok).toBe(true)

    const after = await prisma.disbursementOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(after.status).toBe('CANCELLED')
    expect(after.cancellationReason).toBe('Se repitió la orden')
  })

  it('no se anula una que ya se pagó', async () => {
    const ids = await seedPayrolls(['100.00'])
    const recipient = await newRecipient('Receptora Uno')
    await assignRecipient(approver, ids, recipient)
    await applyTransition(approver, ids, 'APPROVE', null)
    await generateOrders(approver, ids)
    const order = await prisma.disbursementOrder.findFirstOrThrow({ where: { companyId: COMPANY } })
    await payOrder(treasury, {
      orderId: order.id,
      paymentDate: '2026-05-12',
      method: 'WIRE',
      reference: 'REF-X',
      amountPaid: '100.00',
    })

    const result = await cancelOrder(approver, order.id, 'ya no')
    expect(result.ok).toBe(false)
  })
})
