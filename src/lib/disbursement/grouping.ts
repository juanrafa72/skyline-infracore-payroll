/**
 * Agrupación de nóminas en órdenes de desembolso.
 *
 * Se agrupa por (semana + empresa receptora): cada grupo es una transferencia.
 *
 * Puro y en centavos enteros. Los totales de una orden de desembolso son
 * dinero que sale del banco: no pueden depender de una consulta, ni sumarse en
 * coma flotante, ni cuadrarse "casi".
 */
import {
  type Cents,
  ZERO,
  abs,
  add,
  subtract,
  toCents,
  toDecimalString,
} from '@/lib/payroll/engine/money'

export interface PayrollToGroup {
  workerPayrollId: string
  workerId: string
  workerName: string
  payrollWeekId: string
  /** Neto aprobado, como cadena con 2 decimales. */
  netPay: string
  recipientId: string | null
  recipientName: string | null
}

export interface DisbursementGroup {
  payrollWeekId: string
  recipientId: string
  recipientName: string
  items: ReadonlyArray<{
    workerPayrollId: string
    workerId: string
    workerName: string
    amount: Cents
  }>
  total: Cents
}

export interface GroupingResult {
  groups: readonly DisbursementGroup[]
  /** Nóminas sin empresa receptora: bloquean la aprobación. */
  unassigned: ReadonlyArray<{ workerPayrollId: string; workerName: string }>
  /** Suma de todos los grupos. */
  grandTotal: Cents
}

/**
 * Reparte las nóminas en grupos.
 *
 * Las que no tienen empresa receptora NO se meten en ningún grupo ni se
 * reparten a alguna por defecto: se devuelven aparte para que alguien decida.
 * Adivinar a dónde mandar el dinero de una persona no es una opción.
 */
export function groupByRecipient(payrolls: readonly PayrollToGroup[]): GroupingResult {
  const groups = new Map<string, DisbursementGroup>()
  const unassigned: Array<{ workerPayrollId: string; workerName: string }> = []
  let grandTotal = ZERO

  for (const payroll of payrolls) {
    if (!payroll.recipientId) {
      unassigned.push({
        workerPayrollId: payroll.workerPayrollId,
        workerName: payroll.workerName,
      })
      continue
    }

    const amount = toCents(payroll.netPay)
    const key = `${payroll.payrollWeekId}::${payroll.recipientId}`
    const existing = groups.get(key)

    const item = {
      workerPayrollId: payroll.workerPayrollId,
      workerId: payroll.workerId,
      workerName: payroll.workerName,
      amount,
    }

    if (existing) {
      groups.set(key, {
        ...existing,
        items: [...existing.items, item],
        total: add(existing.total, amount),
      })
    } else {
      groups.set(key, {
        payrollWeekId: payroll.payrollWeekId,
        recipientId: payroll.recipientId,
        recipientName: payroll.recipientName ?? '',
        items: [item],
        total: amount,
      })
    }

    grandTotal = add(grandTotal, amount)
  }

  const ordered = [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => a.workerName.localeCompare(b.workerName, 'es')),
    }))
    .sort((a, b) => a.recipientName.localeCompare(b.recipientName, 'es'))

  return { groups: ordered, unassigned, grandTotal }
}

export interface BalanceCheck {
  balanced: boolean
  expected: Cents
  actual: Cents
  difference: Cents
  message: string | null
}

/**
 * La suma de las órdenes tiene que dar exactamente el total aprobado.
 *
 * Se compara en centavos enteros, sin tolerancia. Un centavo de diferencia es
 * un error de reparto, no un redondeo aceptable: significa que alguien va a
 * recibir de más o de menos.
 */
export function checkBalance(
  approvedTotal: Cents,
  groups: readonly DisbursementGroup[],
): BalanceCheck {
  const actual = groups.reduce((accumulator, group) => add(accumulator, group.total), ZERO)
  const difference = subtract(approvedTotal, actual)

  if (difference === ZERO) {
    return { balanced: true, expected: approvedTotal, actual, difference, message: null }
  }

  const missing = difference > ZERO
  return {
    balanced: false,
    expected: approvedTotal,
    actual,
    difference,
    message:
      `Las órdenes suman $${toDecimalString(actual)} y lo aprobado es ` +
      `$${toDecimalString(approvedTotal)}: ` +
      (missing
        ? `faltan $${toDecimalString(difference)} por repartir.`
        : `sobran $${toDecimalString(abs(difference))}.`) +
      ' No se puede continuar hasta que cuadre.',
  }
}
