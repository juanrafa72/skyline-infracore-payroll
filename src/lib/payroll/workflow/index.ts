import { createHash } from 'node:crypto'

/**
 * Flujo de una nómina: quién puede moverla y hacia dónde.
 *
 * Ver docs/PAYROLL_FLOW.md. Aquí está la regla, en un solo lugar y sin
 * depender de la base de datos, para poder probarla exhaustivamente.
 */

export type PayrollStatus =
  | 'DRAFT'
  | 'PREPARED'
  | 'PENDING_APPROVAL'
  | 'REJECTED'
  | 'APPROVED'
  | 'READY_TO_PAY'
  | 'PAYMENT_IN_PROCESS'
  | 'PAID'
  | 'RECONCILED'
  | 'CLOSED'
  | 'IMPORTED_HISTORICAL'

export type WorkflowAction =
  | 'CALCULATE'
  | 'SUBMIT'
  | 'APPROVE'
  | 'REJECT'
  | 'RETURN'
  | 'START_PAYMENT'
  | 'CONFIRM_PAYMENT'
  | 'RECONCILE'
  | 'CLOSE'

interface Transition {
  from: readonly PayrollStatus[]
  to: PayrollStatus
  permission: string
  /** Verbo para los mensajes de error. */
  verb: string
  /** Exige que el actor sea distinto de quien hizo el paso anterior. */
  segregation?: 'preparer' | 'approver'
  reasonRequired?: boolean
}

export const TRANSITIONS: Record<WorkflowAction, Transition> = {
  CALCULATE: {
    from: ['DRAFT', 'PREPARED', 'REJECTED'],
    to: 'PREPARED',
    permission: 'payroll:edit',
    verb: 'calcular',
  },
  SUBMIT: {
    from: ['PREPARED', 'REJECTED'],
    to: 'PENDING_APPROVAL',
    permission: 'payroll:submit',
    verb: 'enviar a aprobación',
  },
  APPROVE: {
    from: ['PENDING_APPROVAL'],
    to: 'APPROVED',
    permission: 'payroll:approve',
    verb: 'aprobar',
    segregation: 'preparer',
  },
  REJECT: {
    from: ['PENDING_APPROVAL'],
    to: 'REJECTED',
    permission: 'payroll:reject',
    verb: 'rechazar',
    segregation: 'preparer',
    reasonRequired: true,
  },
  RETURN: {
    from: ['APPROVED', 'READY_TO_PAY', 'PAYMENT_IN_PROCESS'],
    to: 'PENDING_APPROVAL',
    permission: 'payroll:return',
    verb: 'devolver',
    reasonRequired: true,
  },
  START_PAYMENT: {
    from: ['APPROVED', 'READY_TO_PAY'],
    to: 'PAYMENT_IN_PROCESS',
    permission: 'payment:execute',
    verb: 'iniciar el pago de',
    segregation: 'approver',
  },
  CONFIRM_PAYMENT: {
    from: ['PAYMENT_IN_PROCESS'],
    to: 'PAID',
    permission: 'payment:execute',
    verb: 'confirmar el pago de',
    segregation: 'approver',
  },
  RECONCILE: {
    from: ['PAID'],
    to: 'RECONCILED',
    permission: 'payroll:close',
    verb: 'conciliar',
  },
  CLOSE: {
    from: ['RECONCILED'],
    to: 'CLOSED',
    permission: 'payroll:close',
    verb: 'cerrar',
  },
}

/** Estados en los que la nómina todavía se puede editar. */
export const EDITABLE: readonly PayrollStatus[] = ['DRAFT', 'PREPARED', 'REJECTED']

/** Estados en los que la nómina es intocable. */
export const FROZEN: readonly PayrollStatus[] = ['PAID', 'RECONCILED', 'CLOSED']

export interface TransitionCheck {
  action: WorkflowAction
  current: PayrollStatus
  actorId: string
  permissions: ReadonlySet<string>
  preparedById?: string | null
  approvedById?: string | null
  reason?: string | null
}

export class WorkflowError extends Error {}

/**
 * Verifica si una transición es válida. **Lanza** con el motivo si no lo es.
 *
 * Se comprueban cuatro cosas, en este orden:
 *   1. permiso
 *   2. estado de origen
 *   3. segregación de funciones (por persona, no por rol)
 *   4. motivo obligatorio donde aplica
 */
export function assertTransition(check: TransitionCheck): PayrollStatus {
  const rule = TRANSITIONS[check.action]

  if (!check.permissions.has(rule.permission)) {
    throw new WorkflowError(`No tienes permiso para ${rule.verb} nóminas.`)
  }

  if (!rule.from.includes(check.current)) {
    throw new WorkflowError(
      `No se puede ${rule.verb} una nómina en estado ${LABELS[check.current]}. ` +
        `Solo desde: ${rule.from.map((state) => LABELS[state]).join(', ')}.`,
    )
  }

  if (rule.segregation === 'preparer' && check.preparedById === check.actorId) {
    throw new WorkflowError(
      `No puedes ${rule.verb} una nómina que tú mismo preparaste. Debe hacerlo otra persona.`,
    )
  }

  if (rule.segregation === 'approver' && check.approvedById === check.actorId) {
    throw new WorkflowError(
      `No puedes ${rule.verb} una nómina que tú mismo aprobaste. Debe hacerlo otra persona.`,
    )
  }

  if (rule.reasonRequired && !check.reason?.trim()) {
    throw new WorkflowError(`Para ${rule.verb} hay que escribir el motivo.`)
  }

  return rule.to
}

export const LABELS: Record<PayrollStatus, string> = {
  DRAFT: 'borrador',
  PREPARED: 'preparada',
  PENDING_APPROVAL: 'esperando aprobación',
  REJECTED: 'rechazada',
  APPROVED: 'aprobada',
  READY_TO_PAY: 'lista para pagar',
  PAYMENT_IN_PROCESS: 'pago en proceso',
  PAID: 'pagada',
  RECONCILED: 'conciliada',
  CLOSED: 'cerrada',
  IMPORTED_HISTORICAL: 'histórico importado',
}

// ─────────────────────────────────────────────────────────────
// Huella de los campos materiales
// ─────────────────────────────────────────────────────────────

/**
 * Todo lo que, si cambia, obliga a aprobar de nuevo.
 *
 * Ver docs/PAYROLL_FLOW.md §3. La huella se calcula sobre las ENTRADAS, no
 * sobre el resultado: si alguien cambia un día y el neto casualmente queda
 * igual, la aprobación se invalida de todas formas, porque lo aprobado ya no
 * es lo que hay.
 */
export interface MaterialFields {
  workerId: string
  days: ReadonlyArray<{
    date: string
    dayType: string
    hours: string | null
    shift: string
    projectId: string | null
    crewId: string | null
    additionalAmount: string | null
    additionalNote: string | null
  }>
  rates: ReadonlyArray<{ date: string; amount: string; rateId: string | null }>
  additions: ReadonlyArray<{ category: string; amount: string; description: string }>
  deductions: ReadonlyArray<{ category: string; amount: string; description: string }>
  advanceRecoveries: ReadonlyArray<{ advanceId: string; amount: string }>
  debtRecoveries: ReadonlyArray<{ debtId: string; amount: string }>
  grossPay: string
  netPay: string
}

/**
 * Huella estable de los campos materiales.
 *
 * Se ordena todo antes de firmar: el mismo contenido en distinto orden debe
 * dar la misma huella, o cualquier reordenamiento se vería como un cambio.
 */
export function calculationHash(fields: MaterialFields): string {
  const canonical = {
    workerId: fields.workerId,
    days: [...fields.days]
      .map((day) => [
        day.date,
        day.dayType,
        day.hours ?? '',
        day.shift,
        day.projectId ?? '',
        day.crewId ?? '',
        day.additionalAmount ?? '',
        day.additionalNote?.trim() ?? '',
      ].join('|'))
      .sort(),
    rates: [...fields.rates]
      .map((rate) => [rate.date, rate.amount, rate.rateId ?? ''].join('|'))
      .sort(),
    additions: [...fields.additions]
      .map((row) => [row.category, row.amount, row.description.trim()].join('|'))
      .sort(),
    deductions: [...fields.deductions]
      .map((row) => [row.category, row.amount, row.description.trim()].join('|'))
      .sort(),
    advanceRecoveries: [...fields.advanceRecoveries]
      .map((row) => [row.advanceId, row.amount].join('|'))
      .sort(),
    debtRecoveries: [...fields.debtRecoveries]
      .map((row) => [row.debtId, row.amount].join('|'))
      .sort(),
    grossPay: fields.grossPay,
    netPay: fields.netPay,
  }

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/** ¿Cambió algo material desde que se aprobó? */
export function approvalIsStale(approvedHash: string | null, currentHash: string): boolean {
  return approvedHash !== null && approvedHash !== currentHash
}
