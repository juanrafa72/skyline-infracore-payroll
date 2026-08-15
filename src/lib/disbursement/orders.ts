import type { Prisma } from '@prisma/client'
import type { CurrentUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { type Cents, ZERO, add, toCents, toDecimalString } from '@/lib/payroll/engine/money'
import { applyTransition } from '@/lib/payroll/workflow/service'
import { applyPayableTransition } from '@/lib/payroll/workflow/payables'
import {
  checkBalance,
  groupByRecipient,
  type PayableKind,
  type PayableToGroup,
} from './grouping'
import { formatOrderNumber, nextNumber } from './sequence'

/**
 * Órdenes de desembolso.
 *
 * Una orden es una instrucción de transferencia: cuánto dinero sale, a qué
 * empresa receptora, por qué pagables y de qué semana. Se crean solas al
 * aprobar, agrupando por (semana + empresa receptora). Un pagable puede ser
 * una persona, una cuadrilla (se le paga a su contratista) o un equipo rentado
 * (se le paga a su proveedor).
 *
 * Igual que el resto de servicios, los errores de uso vuelven como mensaje.
 */

export interface OrderResult {
  ok: boolean
  message: string
  orderNumbers?: readonly string[]
}

/** Qué pagables entran a una operación, por tipo. */
export interface PayableSelection {
  workerPayrollIds?: readonly string[]
  crewPayrollIds?: readonly string[]
  equipmentPayrollIds?: readonly string[]
}

/** Estados en los que todavía se puede decidir a dónde va el dinero. */
const ASSIGNABLE = ['DRAFT', 'PREPARED', 'REJECTED', 'PENDING_APPROVAL'] as const
type AssignableStatus = (typeof ASSIGNABLE)[number]

function isAssignable(status: string): boolean {
  return ASSIGNABLE.includes(status as AssignableStatus)
}

// ─────────────────────────────────────────────────────────────
// Asignar empresa receptora
// ─────────────────────────────────────────────────────────────

export interface AssignResult {
  ok: boolean
  message: string
  assigned: number
}

/**
 * Asigna la empresa receptora a uno o varios pagables, del tipo que sean.
 *
 * Sirve igual para una persona que para cincuenta, o para una cuadrilla. Lo
 * que no se puede es reasignar algo ya aprobado — ahí ya existe una orden de
 * desembolso, y cambiarla por debajo dejaría el documento diciendo una cosa y
 * la base otra. Para eso se devuelve el pagable, que ya queda registrado.
 */
export async function assignRecipientToPayables(
  user: CurrentUser,
  selection: PayableSelection,
  recipientId: string,
): Promise<AssignResult> {
  const workerIds = [...(selection.workerPayrollIds ?? [])]
  const crewIds = [...(selection.crewPayrollIds ?? [])]
  const equipmentIds = [...(selection.equipmentPayrollIds ?? [])]

  if (workerIds.length + crewIds.length + equipmentIds.length === 0) {
    return { ok: false, message: 'No marcaste a nadie.', assigned: 0 }
  }

  const recipient = await prisma.paymentRecipient.findFirst({
    where: { id: recipientId, companyId: user.companyId },
  })
  if (!recipient) {
    return { ok: false, message: 'Esa empresa receptora no existe.', assigned: 0 }
  }
  if (!recipient.active) {
    return {
      ok: false,
      message: `«${recipient.name}» está inactiva. Actívala primero o escoge otra.`,
      assigned: 0,
    }
  }

  const [workers, crews, equipment] = await Promise.all([
    workerIds.length > 0
      ? prisma.workerPayroll.findMany({
          where: { id: { in: workerIds }, companyId: user.companyId },
          include: { worker: true },
        })
      : [],
    crewIds.length > 0
      ? prisma.crewPayroll.findMany({
          where: { id: { in: crewIds }, companyId: user.companyId },
        })
      : [],
    equipmentIds.length > 0
      ? prisma.equipmentPayroll.findMany({
          where: { id: { in: equipmentIds }, companyId: user.companyId },
        })
      : [],
  ])

  const assignableWorkers = workers.filter((row) => isAssignable(row.status))
  const assignableCrews = crews.filter((row) => isAssignable(row.status))
  const assignableEquipment = equipment.filter((row) => isAssignable(row.status))

  const blocked =
    workers.length + crews.length + equipment.length -
    (assignableWorkers.length + assignableCrews.length + assignableEquipment.length)
  const assigned =
    assignableWorkers.length + assignableCrews.length + assignableEquipment.length

  if (assigned === 0) {
    return {
      ok: false,
      message:
        'Ninguna se puede cambiar: ya están aprobadas o pagadas. Si hay que corregir a dónde va el dinero, devuelve la nómina.',
      assigned: 0,
    }
  }

  const stamp = {
    paymentRecipientId: recipientId,
    recipientAssignedById: user.id,
    recipientAssignedAt: new Date(),
  }

  const names = [
    ...assignableWorkers.map((row) => row.worker.displayName),
    ...assignableCrews.map((row) => `Cuadrilla ${row.crewNameSnapshot}`),
    ...assignableEquipment.map((row) => `Equipo ${row.equipmentNameSnapshot}`),
  ]

  await prisma.$transaction(async (tx) => {
    if (assignableWorkers.length > 0) {
      await tx.workerPayroll.updateMany({
        where: { id: { in: assignableWorkers.map((row) => row.id) } },
        data: stamp,
      })
    }
    if (assignableCrews.length > 0) {
      await tx.crewPayroll.updateMany({
        where: { id: { in: assignableCrews.map((row) => row.id) } },
        data: stamp,
      })
    }
    if (assignableEquipment.length > 0) {
      await tx.equipmentPayroll.updateMany({
        where: { id: { in: assignableEquipment.map((row) => row.id) } },
        data: stamp,
      })
    }

    const first = assignableWorkers[0] ?? assignableCrews[0] ?? assignableEquipment[0]
    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'RECIPIENT_ASSIGNED',
        entityType: assignableWorkers.length > 0 ? 'WorkerPayroll' : assignableCrews.length > 0 ? 'CrewPayroll' : 'EquipmentPayroll',
        entityId: first!.id,
        payrollWeekId: first!.payrollWeekId,
        newValueJson: {
          recipient: recipient.name,
          recipientId,
          workers: names,
        },
        changedFields: ['paymentRecipientId'],
        reason: `Empresa receptora «${recipient.name}» asignada a ${assigned} pagable(s)`,
      },
    })
  })

  const message =
    blocked === 0
      ? `${assigned} se pagarán con fondos a «${recipient.name}».`
      : `${assigned} asignada(s) a «${recipient.name}». ${blocked} quedaron fuera: ya están aprobadas o pagadas.`

  return { ok: true, message, assigned }
}

/** Puerta de compatibilidad: asignación solo de personas, la firma original. */
export async function assignRecipient(
  user: CurrentUser,
  workerPayrollIds: readonly string[],
  recipientId: string,
): Promise<AssignResult> {
  return assignRecipientToPayables(user, { workerPayrollIds }, recipientId)
}

// ─────────────────────────────────────────────────────────────
// Cargar pagables como filas agrupables
// ─────────────────────────────────────────────────────────────

interface LoadedPayables {
  rows: PayableToGroup[]
  weeks: Map<string, { label: string; year: number; startDate: Date; endDate: Date }>
  preparedById: string | null
  /** contratista de cada CrewPayroll, para el pago. */
  contractorByCrewPayroll: Map<string, string | null>
}

/**
 * Trae los pagables aprobados y sin orden, ya con su forma de agrupación.
 *
 * El `crewLabel` de cada persona sale de las líneas de SU nómina esa semana
 * (el dato ya congelado), no de su cuadrilla "actual": el desglose de una
 * orden vieja debe decir dónde trabajó ESA semana.
 */
async function loadApprovedPayables(
  companyId: string,
  selection: PayableSelection,
): Promise<LoadedPayables> {
  const [workers, crews] = await Promise.all([
    (selection.workerPayrollIds?.length ?? 0) > 0
      ? prisma.workerPayroll.findMany({
          where: {
            id: { in: [...selection.workerPayrollIds!] },
            companyId,
            status: { in: ['APPROVED', 'READY_TO_PAY'] },
            disbursementItem: null,
          },
          include: { worker: true, payrollWeek: true, paymentRecipient: true },
        })
      : [],
    (selection.crewPayrollIds?.length ?? 0) > 0
      ? prisma.crewPayroll.findMany({
          where: {
            id: { in: [...selection.crewPayrollIds!] },
            companyId,
            status: { in: ['APPROVED', 'READY_TO_PAY'] },
            disbursementItem: null,
          },
          include: { payrollWeek: true, paymentRecipient: true },
        })
      : [],
  ])

  const lines =
    workers.length > 0
      ? await prisma.payrollLine.findMany({
          where: { workerPayrollId: { in: workers.map((row) => row.id) }, crewId: { not: null } },
          select: { workerPayrollId: true, crewId: true },
        })
      : []
  const crewIds = [...new Set(lines.map((line) => line.crewId!))]
  const crewNames = new Map(
    (
      await prisma.crew.findMany({ where: { id: { in: crewIds } }, select: { id: true, name: true } })
    ).map((crew) => [crew.id, crew.name]),
  )
  const crewsOfPayroll = new Map<string, Set<string>>()
  for (const line of lines) {
    const set = crewsOfPayroll.get(line.workerPayrollId) ?? new Set<string>()
    const name = crewNames.get(line.crewId!)
    if (name) set.add(name)
    crewsOfPayroll.set(line.workerPayrollId, set)
  }

  const rows: PayableToGroup[] = [
    ...workers.map((payroll) => ({
      kind: 'WORKER' as PayableKind,
      payableId: payroll.id,
      refId: payroll.workerId,
      name: payroll.worker.displayName,
      crewLabel: (() => {
        const names = [...(crewsOfPayroll.get(payroll.id) ?? [])].sort((a, b) =>
          a.localeCompare(b, 'es'),
        )
        return names.length > 0 ? names.join(' / ') : null
      })(),
      payrollWeekId: payroll.payrollWeekId,
      amount: payroll.netPay.toFixed(2),
      recipientId: payroll.paymentRecipientId,
      recipientName: payroll.paymentRecipient?.name ?? null,
    })),
    ...crews.map((payroll) => ({
      kind: 'CREW' as PayableKind,
      payableId: payroll.id,
      refId: payroll.crewId,
      name: `Cuadrilla ${payroll.crewNameSnapshot}${payroll.contractorNameSnapshot ? ` → ${payroll.contractorNameSnapshot}` : ''}`,
      crewLabel: payroll.crewNameSnapshot,
      payrollWeekId: payroll.payrollWeekId,
      amount: payroll.productionTotal.toFixed(2),
      recipientId: payroll.paymentRecipientId,
      recipientName: payroll.paymentRecipient?.name ?? null,
    })),
  ]

  const weeks = new Map<string, { label: string; year: number; startDate: Date; endDate: Date }>()
  for (const payroll of workers) {
    weeks.set(payroll.payrollWeekId, payroll.payrollWeek)
  }
  for (const payroll of crews) {
    weeks.set(payroll.payrollWeekId, payroll.payrollWeek)
  }

  return {
    rows,
    weeks,
    preparedById:
      workers.find((row) => row.preparedById)?.preparedById ??
      crews.find((row) => row.preparedById)?.preparedById ??
      null,
    contractorByCrewPayroll: new Map(crews.map((row) => [row.id, row.contractorId])),
  }
}

// ─────────────────────────────────────────────────────────────
// Resumen antes de aprobar
// ─────────────────────────────────────────────────────────────

export interface PreviewGroup {
  recipientId: string
  recipientName: string
  payrollWeekId: string
  weekLabel: string
  period: string
  workers: ReadonlyArray<{ name: string; amount: string }>
  total: string
}

export interface ApprovalPreview {
  groups: readonly PreviewGroup[]
  unassigned: ReadonlyArray<{ payableId: string; name: string }>
  grandTotal: string
  balanced: boolean
  balanceMessage: string | null
}

/**
 * Lo que verá quien aprueba antes de confirmar: cuánto sale hacia cada empresa
 * receptora, con nombre y monto de cada pagable.
 */
export async function previewApproval(
  companyId: string,
  selection: PayableSelection,
): Promise<ApprovalPreview> {
  const workerIds = [...(selection.workerPayrollIds ?? [])]
  const crewIds = [...(selection.crewPayrollIds ?? [])]

  const [workers, crews] = await Promise.all([
    workerIds.length > 0
      ? prisma.workerPayroll.findMany({
          where: { id: { in: workerIds }, companyId },
          include: { worker: true, payrollWeek: true, paymentRecipient: true },
        })
      : [],
    crewIds.length > 0
      ? prisma.crewPayroll.findMany({
          where: { id: { in: crewIds }, companyId },
          include: { payrollWeek: true, paymentRecipient: true },
        })
      : [],
  ])

  const toGroup: PayableToGroup[] = [
    ...workers.map((payroll) => ({
      kind: 'WORKER' as PayableKind,
      payableId: payroll.id,
      refId: payroll.workerId,
      name: payroll.worker.displayName,
      crewLabel: null,
      payrollWeekId: payroll.payrollWeekId,
      amount: payroll.netPay.toFixed(2),
      recipientId: payroll.paymentRecipientId,
      recipientName: payroll.paymentRecipient?.name ?? null,
    })),
    ...crews.map((payroll) => ({
      kind: 'CREW' as PayableKind,
      payableId: payroll.id,
      refId: payroll.crewId,
      name: `Cuadrilla ${payroll.crewNameSnapshot}`,
      crewLabel: payroll.crewNameSnapshot,
      payrollWeekId: payroll.payrollWeekId,
      amount: payroll.productionTotal.toFixed(2),
      recipientId: payroll.paymentRecipientId,
      recipientName: payroll.paymentRecipient?.name ?? null,
    })),
  ]

  const { groups, unassigned, grandTotal } = groupByRecipient(toGroup)

  const approvedTotal = toGroup.reduce<Cents>(
    (accumulator, row) => add(accumulator, toCents(row.amount)),
    ZERO,
  )
  const balance = checkBalance(approvedTotal, groups)

  const weekById = new Map([
    ...workers.map((payroll) => [payroll.payrollWeekId, payroll.payrollWeek] as const),
    ...crews.map((payroll) => [payroll.payrollWeekId, payroll.payrollWeek] as const),
  ])

  return {
    groups: groups.map((group) => {
      const week = weekById.get(group.payrollWeekId)
      return {
        recipientId: group.recipientId,
        recipientName: group.recipientName,
        payrollWeekId: group.payrollWeekId,
        weekLabel: week ? `${week.label} · ${week.year}` : '',
        period: week
          ? `${week.startDate.toISOString().slice(0, 10)} → ${week.endDate.toISOString().slice(0, 10)}`
          : '',
        workers: group.items.map((item) => ({
          name: item.name,
          amount: toDecimalString(item.amount),
        })),
        total: toDecimalString(group.total),
      }
    }),
    unassigned: unassigned.map((row) => ({ payableId: row.payableId, name: row.name })),
    grandTotal: toDecimalString(grandTotal),
    // Con pagables sin asignar nunca cuadra: esa plata no está repartida.
    balanced: balance.balanced && unassigned.length === 0,
    balanceMessage:
      unassigned.length > 0
        ? `${unassigned.length} pagable(s) no tienen empresa receptora. Asígnaselas antes de aprobar.`
        : balance.message,
  }
}

// ─────────────────────────────────────────────────────────────
// Generar las órdenes
// ─────────────────────────────────────────────────────────────

/**
 * Crea las órdenes de desembolso de un conjunto de pagables ya aprobados.
 *
 * Idempotente: un pagable que ya está en una orden no entra en otra. Si ya hay
 * una orden abierta para esa semana y esa receptora, se le agregan los nuevos;
 * si la que existe ya tiene dinero desembolsado, se crea una nueva con su
 * propio consecutivo, porque lo que ya salió del banco no se toca.
 */
export async function generateOrders(
  user: CurrentUser,
  selection: PayableSelection,
): Promise<OrderResult> {
  const loaded = await loadApprovedPayables(user.companyId, selection)

  if (loaded.rows.length === 0) {
    return { ok: true, message: 'No había nada nuevo por agrupar.', orderNumbers: [] }
  }

  const withoutRecipient = loaded.rows.filter((row) => !row.recipientId)
  if (withoutRecipient.length > 0) {
    return {
      ok: false,
      message: `No se pueden generar las órdenes: ${withoutRecipient
        .map((row) => row.name)
        .join(', ')} no tienen empresa receptora.`,
    }
  }

  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } })

  const { groups } = groupByRecipient(loaded.rows)

  const created: string[] = []
  const preparer = loaded.preparedById
    ? await prisma.user.findUnique({ where: { id: loaded.preparedById }, select: { name: true } })
    : null

  for (const group of groups) {
    const week = loaded.weeks.get(group.payrollWeekId)
    if (!week) continue

    const recipient = await prisma.paymentRecipient.findUniqueOrThrow({
      where: { id: group.recipientId },
    })

    await prisma.$transaction(async (tx) => {
      const open = await tx.disbursementOrder.findFirst({
        where: {
          companyId: user.companyId,
          payrollWeekId: group.payrollWeekId,
          recipientId: group.recipientId,
          status: 'PENDING_PAYMENT',
        },
      })

      const items = group.items.map((item) => ({
        companyId: user.companyId,
        itemNameSnapshot: item.name,
        crewLabelSnapshot: item.crewLabel,
        amount: toDecimalString(item.amount),
        ...(item.kind === 'WORKER'
          ? { workerPayrollId: item.payableId, workerId: item.refId }
          : {}),
        ...(item.kind === 'CREW' ? { crewPayrollId: item.payableId } : {}),
        ...(item.kind === 'EQUIPMENT' ? { equipmentPayrollId: item.payableId } : {}),
      }))

      if (open) {
        await tx.disbursementOrderItem.createMany({
          data: items.map((item) => ({ ...item, disbursementOrderId: open.id })),
        })

        const totals = await tx.disbursementOrderItem.aggregate({
          where: { disbursementOrderId: open.id },
          _sum: { amount: true },
          _count: true,
        })

        await tx.disbursementOrder.update({
          where: { id: open.id },
          data: {
            totalAmount: totals._sum.amount ?? 0,
            itemCount: totals._count,
            approvedById: user.id,
            approvedByName: user.name,
            approvedAt: new Date(),
          },
        })

        created.push(open.orderNumber)
        return
      }

      const year = week.startDate.getUTCFullYear()
      const number = await nextNumber(user.companyId, 'DISBURSEMENT_ORDER', year, tx)
      const orderNumber = formatOrderNumber(company.code, year, number)

      const order = await tx.disbursementOrder.create({
        data: {
          companyId: user.companyId,
          payrollWeekId: group.payrollWeekId,
          recipientId: group.recipientId,
          orderNumber,
          itemCount: group.items.length,
          totalAmount: toDecimalString(group.total),
          companyNameSnapshot: company.displayName,
          recipientNameSnapshot: recipient.name,
          recipientTaxIdSnapshot: recipient.taxId,
          weekLabelSnapshot: `${week.label} · ${week.year}`,
          periodStart: week.startDate,
          periodEnd: week.endDate,
          preparedByName: preparer?.name ?? null,
          approvedById: user.id,
          approvedByName: user.name,
          approvedAt: new Date(),
          createdById: user.id,
          items: { create: items },
        },
      })

      await tx.auditLog.create({
        data: {
          companyId: user.companyId,
          userId: user.id,
          userEmailSnapshot: user.email,
          action: 'DISBURSEMENT_ORDER_CREATED',
          entityType: 'DisbursementOrder',
          entityId: order.id,
          payrollWeekId: group.payrollWeekId,
          newValueJson: {
            orderNumber,
            recipient: recipient.name,
            total: toDecimalString(group.total),
            workers: group.items.map((item) => item.name),
          },
          changedFields: ['orderNumber', 'totalAmount'],
          reason: `Orden ${orderNumber} · ${group.items.length} pagable(s) · $${toDecimalString(group.total)}`,
        },
      })

      created.push(orderNumber)
    })
  }

  return {
    ok: true,
    message:
      created.length === 1
        ? `Se generó la orden ${created[0]}.`
        : `Se generaron ${created.length} órdenes de desembolso.`,
    orderNumbers: created,
  }
}

// ─────────────────────────────────────────────────────────────
// Registrar el pago
// ─────────────────────────────────────────────────────────────

export interface PayOrderInput {
  orderId: string
  paymentDate: string
  method: 'ZELLE' | 'ACH' | 'WIRE' | 'CHECK' | 'CASH' | 'OTHER'
  bankName?: string | null
  reference: string
  amountPaid: string
  notes?: string | null
  differenceReason?: string | null
  /**
   * Renglones de la orden que cubre esta transferencia. Vacío = todos los que
   * faltan. Sirve cuando el dinero llegó en dos giros.
   */
  itemIds?: readonly string[]
}

type OrderItemWithPayables = Prisma.DisbursementOrderItemGetPayload<{
  include: {
    workerPayroll: { include: { worker: true } }
    crewPayroll: true
    equipmentPayroll: true
  }
}>

function itemStatus(item: OrderItemWithPayables): string {
  return (
    item.workerPayroll?.status ??
    item.crewPayroll?.status ??
    item.equipmentPayroll?.status ??
    'PAID'
  )
}

/**
 * Registra la transferencia de una orden.
 *
 * Se crea un pago por renglón — así se conservan los comprobantes, las
 * diferencias y los ajustes que ya existen por beneficiario — pero todos
 * comparten la referencia bancaria y quedan colgados de la misma orden. El
 * beneficiario depende del pagable: la persona, el CONTRATISTA de la
 * cuadrilla, o el PROVEEDOR del equipo (BR-121).
 *
 * La regla dura: **lo transferido tiene que ser exactamente la suma de los
 * renglones que se marcaron**. Si no coincide, no se registra nada. Un número
 * que no cuadra con nadie hace imposible saber a quién le llegó.
 */
export async function payOrder(user: CurrentUser, input: PayOrderInput): Promise<OrderResult> {
  const order = await prisma.disbursementOrder.findFirst({
    where: { id: input.orderId, companyId: user.companyId },
    include: {
      items: {
        include: {
          workerPayroll: { include: { worker: true } },
          crewPayroll: true,
          equipmentPayroll: true,
        },
      },
      recipient: true,
    },
  })

  if (!order) return { ok: false, message: 'Esa orden de desembolso no existe.' }
  if (order.status === 'PAID') {
    return { ok: false, message: `La orden ${order.orderNumber} ya está pagada completa.` }
  }
  if (order.status === 'CANCELLED') {
    return { ok: false, message: `La orden ${order.orderNumber} está anulada.` }
  }

  const pending = order.items.filter(
    (item) => !['PAID', 'RECONCILED', 'CLOSED'].includes(itemStatus(item)),
  )
  if (pending.length === 0) {
    return { ok: false, message: 'Todo lo de esta orden ya está pagado.' }
  }

  const selectedIds = new Set(
    input.itemIds && input.itemIds.length > 0 ? input.itemIds : pending.map((item) => item.id),
  )
  const selected = pending.filter((item) => selectedIds.has(item.id))

  if (selected.length === 0) {
    return { ok: false, message: 'No marcaste ningún renglón de esta orden.' }
  }

  const expected = selected.reduce<Cents>(
    (accumulator, item) => add(accumulator, toCents(item.amount.toFixed(2))),
    ZERO,
  )
  const paying = toCents(input.amountPaid)

  if (paying !== expected) {
    return {
      ok: false,
      message:
        `Marcaste ${selected.length} renglón(es) que suman $${toDecimalString(expected)}, ` +
        `pero escribiste $${toDecimalString(paying)}. ` +
        'Los dos números tienen que coincidir: si transferiste otra cantidad, marca exactamente a quiénes cubre.',
    }
  }

  const partial = selected.length < order.items.length
  if (partial && !input.differenceReason?.trim()) {
    return {
      ok: false,
      message:
        `Esta transferencia cubre ${selected.length} de ${order.items.length} renglones. ` +
        'Escribe por qué van aparte: quien revise después necesita saberlo.',
    }
  }

  // Una referencia repetida casi siempre es un pago registrado dos veces.
  const duplicate = await prisma.payment.findFirst({
    where: {
      companyId: user.companyId,
      reference: input.reference.trim(),
      NOT: { disbursementOrderId: order.id },
    },
    include: { disbursementOrder: true },
  })
  if (duplicate) {
    return {
      ok: false,
      message: `Esa referencia ya se usó${
        duplicate.disbursementOrder ? ` en la orden ${duplicate.disbursementOrder.orderNumber}` : ''
      }. Verifica que no sea un pago repetido.`,
    }
  }

  const workerIds = selected
    .filter((item) => item.workerPayrollId)
    .map((item) => item.workerPayrollId!)
  const crewIds = selected.filter((item) => item.crewPayrollId).map((item) => item.crewPayrollId!)
  const equipmentIds = selected
    .filter((item) => item.equipmentPayrollId)
    .map((item) => item.equipmentPayrollId!)

  // Primero la transición. Si esta persona no puede pagar esto, no se crea nada.
  const skipped: string[] = []
  let moved = 0
  if (workerIds.length > 0) {
    const started = await applyTransition(user, workerIds, 'START_PAYMENT', null)
    moved += started.moved
    skipped.push(...started.skipped.map((row) => `${row.workerName}: ${row.reason}`))
  }
  if (crewIds.length > 0) {
    const started = await applyPayableTransition(user, 'CREW', crewIds, 'START_PAYMENT', null)
    moved += started.moved
    skipped.push(...started.skipped.map((row) => `${row.name}: ${row.reason}`))
  }
  if (equipmentIds.length > 0) {
    const started = await applyPayableTransition(
      user,
      'EQUIPMENT',
      equipmentIds,
      'START_PAYMENT',
      null,
    )
    moved += started.moved
    skipped.push(...started.skipped.map((row) => `${row.name}: ${row.reason}`))
  }
  if (moved === 0) {
    return { ok: false, message: skipped[0] ?? 'No se pudo iniciar el pago.' }
  }
  if (skipped.length > 0) {
    return { ok: false, message: `No se registró nada. ${skipped.join(' · ')}` }
  }

  const count = await prisma.payment.count({ where: { companyId: user.companyId } })
  const now = new Date()
  const paymentDate = new Date(`${input.paymentDate}T00:00:00Z`)
  const reference = input.reference.trim()

  await prisma.$transaction(async (tx) => {
    for (const [index, item] of selected.entries()) {
      const base = {
        companyId: user.companyId,
        paymentNumber: `PAY-${String(count + index + 1).padStart(5, '0')}`,
        payrollWeekId: order.payrollWeekId,
        disbursementOrderId: order.id,
        approvedAmount: item.amount,
        amountPaid: item.amount,
        paymentDate,
        method: input.method,
        reference,
        notes: input.notes?.trim() || null,
        status: 'PAID' as const,
        paidById: user.id,
        paidAt: now,
        bankAccountLast4: order.recipient.bankAccountLast4,
      }

      if (item.workerPayrollId) {
        const payment = await tx.payment.create({
          data: { ...base, payeeType: 'WORKER', workerId: item.workerId! },
        })
        await tx.workerPayroll.update({
          where: { id: item.workerPayrollId },
          data: { paymentId: payment.id },
        })
      } else if (item.crewPayrollId) {
        /*
         * El beneficiario legal es el CONTRATISTA de la cuadrilla (la puerta
         * de APPROVE garantiza que existe). La receptora es el conducto por
         * donde pasa la plata; el contratista es quien la cobra.
         */
        const payment = await tx.payment.create({
          data: {
            ...base,
            payeeType: 'CONTRACTOR',
            contractorId: item.crewPayroll!.contractorId!,
          },
        })
        await tx.crewPayroll.update({
          where: { id: item.crewPayrollId },
          data: { paymentId: payment.id },
        })
      } else if (item.equipmentPayrollId) {
        // Un equipo jamás recibe pagos: cobra su proveedor — BR-121.
        const payment = await tx.payment.create({
          data: {
            ...base,
            payeeType: 'VENDOR',
            vendorId: item.equipmentPayroll!.vendorId!,
          },
        })
        await tx.equipmentPayroll.update({
          where: { id: item.equipmentPayrollId },
          data: { paymentId: payment.id },
        })
      }
    }

    const paidSoFar = add(toCents(order.amountPaid.toFixed(2)), paying)
    const total = toCents(order.totalAmount.toFixed(2))
    const complete = paidSoFar === total

    await tx.disbursementOrder.update({
      where: { id: order.id },
      data: {
        amountPaid: toDecimalString(paidSoFar),
        status: complete ? 'PAID' : 'PARTIALLY_PAID',
        paidById: user.id,
        paidByName: user.name,
        paidAt: now,
        paymentDate,
        method: input.method,
        bankName: input.bankName?.trim() || null,
        reference,
        paymentNotes: input.notes?.trim() || null,
        differenceReason: input.differenceReason?.trim() || order.differenceReason,
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'DISBURSEMENT_PAID',
        entityType: 'DisbursementOrder',
        entityId: order.id,
        payrollWeekId: order.payrollWeekId,
        oldValueJson: { status: order.status, paid: order.amountPaid.toFixed(2) },
        newValueJson: {
          orderNumber: order.orderNumber,
          recipient: order.recipientNameSnapshot,
          status: complete ? 'PAID' : 'PARTIALLY_PAID',
          paid: toDecimalString(paidSoFar),
          reference,
          method: input.method,
          workers: selected.map((item) => item.itemNameSnapshot),
        },
        changedFields: ['status', 'amountPaid', 'reference'],
        reason: input.differenceReason?.trim() || input.notes?.trim() || null,
      },
    })
  })

  if (workerIds.length > 0) await applyTransition(user, workerIds, 'CONFIRM_PAYMENT', null)
  if (crewIds.length > 0) {
    await applyPayableTransition(user, 'CREW', crewIds, 'CONFIRM_PAYMENT', null)
  }
  if (equipmentIds.length > 0) {
    await applyPayableTransition(user, 'EQUIPMENT', equipmentIds, 'CONFIRM_PAYMENT', null)
  }

  return {
    ok: true,
    message:
      `${order.orderNumber} · $${toDecimalString(paying)} a «${order.recipientNameSnapshot}» ` +
      `· ${selected.length} renglón(es)` +
      (partial ? `. Quedan ${order.items.length - selected.length} por pagar en esta orden.` : '.'),
    orderNumbers: [order.orderNumber],
  }
}

// ─────────────────────────────────────────────────────────────
// Anular, documentar, enviar a contabilidad
// ─────────────────────────────────────────────────────────────

export async function cancelOrder(
  user: CurrentUser,
  orderId: string,
  reason: string,
): Promise<OrderResult> {
  if (!reason.trim()) {
    return { ok: false, message: 'Escribe por qué se anula. Sin motivo no se puede.' }
  }

  const order = await prisma.disbursementOrder.findFirst({
    where: { id: orderId, companyId: user.companyId },
  })
  if (!order) return { ok: false, message: 'Esa orden no existe.' }
  if (order.status !== 'PENDING_PAYMENT') {
    return {
      ok: false,
      message: `La orden ${order.orderNumber} ya tiene dinero desembolsado o está anulada. No se puede anular.`,
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.disbursementOrder.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        cancelledById: user.id,
        cancelledAt: new Date(),
        cancellationReason: reason.trim(),
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'DISBURSEMENT_ORDER_CANCELLED',
        entityType: 'DisbursementOrder',
        entityId: orderId,
        payrollWeekId: order.payrollWeekId,
        oldValueJson: { status: order.status },
        newValueJson: { status: 'CANCELLED' },
        changedFields: ['status'],
        reason: reason.trim(),
      },
    })
  })

  return { ok: true, message: `Orden ${order.orderNumber} anulada. El motivo quedó registrado.` }
}

/**
 * Registra el comprobante de la transferencia.
 *
 * El archivo vive en SharePoint; aquí queda la referencia con la que se ubica.
 * Ver CLAUDE.md, fronteras de proveedores: la base guarda datos, no archivos.
 */
export async function attachDocument(
  user: CurrentUser,
  orderId: string,
  input: { kind: 'PAYMENT_PROOF' | 'ORDER_PDF' | 'OTHER'; fileName: string; fileRef: string; notes?: string | null },
): Promise<OrderResult> {
  const order = await prisma.disbursementOrder.findFirst({
    where: { id: orderId, companyId: user.companyId },
  })
  if (!order) return { ok: false, message: 'Esa orden no existe.' }

  const fileRef = input.fileRef.trim()
  if (!fileRef) {
    return { ok: false, message: 'Falta el enlace del comprobante en SharePoint.' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.disbursementDocument.create({
      data: {
        companyId: user.companyId,
        disbursementOrderId: orderId,
        kind: input.kind,
        fileName: input.fileName.trim() || 'comprobante',
        fileRef,
        notes: input.notes?.trim() || null,
        uploadedById: user.id,
        uploadedByName: user.name,
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'DISBURSEMENT_DOCUMENT_ATTACHED',
        entityType: 'DisbursementOrder',
        entityId: orderId,
        payrollWeekId: order.payrollWeekId,
        newValueJson: { kind: input.kind, fileName: input.fileName, fileRef },
        changedFields: ['documents'],
      },
    })
  })

  return { ok: true, message: 'Comprobante registrado y asociado a la orden.' }
}

/**
 * Deja constancia de que el soporte se le pasó a contabilidad.
 *
 * Todavía no hay envío de correo. Se registra el hecho y a quién, que es lo
 * que después alguien va a necesitar demostrar; conectar el correo no cambia
 * este registro.
 */
export async function markSentToAccounting(
  user: CurrentUser,
  orderId: string,
  sentTo: string,
): Promise<OrderResult> {
  const order = await prisma.disbursementOrder.findFirst({
    where: { id: orderId, companyId: user.companyId },
  })
  if (!order) return { ok: false, message: 'Esa orden no existe.' }

  const destination = sentTo.trim()
  if (!destination) {
    return { ok: false, message: 'Escribe a quién se le envió (correo o nombre).' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.disbursementOrder.update({
      where: { id: orderId },
      data: {
        sentToAccountingAt: new Date(),
        sentToAccountingById: user.id,
        sentToAccountingTo: destination,
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'DISBURSEMENT_SENT_TO_ACCOUNTING',
        entityType: 'DisbursementOrder',
        entityId: orderId,
        payrollWeekId: order.payrollWeekId,
        newValueJson: { orderNumber: order.orderNumber, sentTo: destination },
        changedFields: ['sentToAccountingAt'],
      },
    })
  })

  return { ok: true, message: `${order.orderNumber} marcada como enviada a ${destination}.` }
}
