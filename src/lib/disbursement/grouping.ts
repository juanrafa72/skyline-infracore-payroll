/**
 * Agrupación de pagables en órdenes de desembolso.
 *
 * Se agrupa por (semana + empresa receptora): cada grupo es una transferencia.
 * Un pagable puede ser una PERSONA (su neto), una CUADRILLA (la producción que
 * se le debe al contratista) o un EQUIPO rentado (sus días); la orden los
 * mezcla sin despeinarse porque el dinero no distingue.
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

export type PayableKind = 'WORKER' | 'CREW' | 'EQUIPMENT'

export interface PayableToGroup {
  kind: PayableKind
  /** Id del pagable: WorkerPayroll, CrewPayroll o EquipmentPayroll. */
  payableId: string
  /** Id de la entidad de fondo: persona, cuadrilla o equipo. */
  refId: string
  /** Cómo se muestra en la orden y en el PDF. */
  name: string
  /** Cuadrilla del renglón, para el desglose. null = "Sin cuadrilla". */
  crewLabel: string | null
  /**
   * Contra QUÉ se está pagando ese monto: "5 días", "3 registro(s) de
   * producción", "4 día(s) × $450.00". Solo para mostrar — quien aprueba no
   * debería tener que abrir otra pantalla para saber a cuántos días equivale
   * un pago. Nunca entra en la suma ni en el nombre que se congela.
   */
  detail: string | null
  payrollWeekId: string
  /** Monto aprobado, como cadena con 2 decimales. */
  amount: string
  recipientId: string | null
  recipientName: string | null
}

export interface GroupItem {
  kind: PayableKind
  payableId: string
  refId: string
  name: string
  crewLabel: string | null
  /** "5 días", "3 registro(s) de producción"… — solo para mostrar. */
  detail: string | null
  amount: Cents
}

export interface DisbursementGroup {
  payrollWeekId: string
  recipientId: string
  recipientName: string
  items: ReadonlyArray<GroupItem>
  total: Cents
}

export interface GroupingResult {
  groups: readonly DisbursementGroup[]
  /** Pagables sin empresa receptora: bloquean la aprobación. */
  unassigned: ReadonlyArray<{ payableId: string; kind: PayableKind; name: string }>
  /** Suma de todos los grupos. */
  grandTotal: Cents
}

/**
 * Reparte los pagables en grupos.
 *
 * Los que no tienen empresa receptora NO se meten en ningún grupo ni se
 * reparten a alguna por defecto: se devuelven aparte para que alguien decida.
 * Adivinar a dónde mandar el dinero de alguien no es una opción.
 */
export function groupByRecipient(payables: readonly PayableToGroup[]): GroupingResult {
  const groups = new Map<string, DisbursementGroup>()
  const unassigned: Array<{ payableId: string; kind: PayableKind; name: string }> = []
  let grandTotal = ZERO

  for (const payable of payables) {
    if (!payable.recipientId) {
      unassigned.push({
        payableId: payable.payableId,
        kind: payable.kind,
        name: payable.name,
      })
      continue
    }

    const amount = toCents(payable.amount)
    const key = `${payable.payrollWeekId}::${payable.recipientId}`
    const existing = groups.get(key)

    const item: GroupItem = {
      kind: payable.kind,
      payableId: payable.payableId,
      refId: payable.refId,
      name: payable.name,
      crewLabel: payable.crewLabel,
      detail: payable.detail,
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
        payrollWeekId: payable.payrollWeekId,
        recipientId: payable.recipientId,
        recipientName: payable.recipientName ?? '',
        items: [item],
        total: amount,
      })
    }

    grandTotal = add(grandTotal, amount)
  }

  const ordered = [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => a.name.localeCompare(b.name, 'es')),
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
