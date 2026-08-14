/**
 * Préstamos y financiaciones: la parte que decide, pura y sin base de datos.
 *
 * Dos reglas gobiernan todo esto:
 *
 * 1. **El saldo NO es una columna.** Se deriva de los movimientos:
 *    `saldo = prestado − Σ recuperado`. Una columna de saldo se desincroniza
 *    el día que alguien inserte una recuperación sin actualizarla, y entonces
 *    el sistema cobra de más o de menos sin que nadie lo note — BR-083.
 *
 * 2. **Nunca se descuenta más de lo que se debe.** Aunque el plan diga $200 y
 *    el saldo sea $50, se descuentan $50. Cobrar de más es robar.
 */
import { type Cents, ZERO, add, min, percentage, subtract, toDecimalString } from '@/lib/payroll/engine/money'

export type AdvanceStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'ACTIVE'
  | 'PARTIALLY_RECOVERED'
  | 'PAID'
  | 'CANCELLED'

export type RecoveryMethod =
  | 'FIXED_WEEKLY'
  | 'PERCENTAGE_OF_NET'
  | 'PERCENTAGE_WITH_CAP'
  | 'MANUAL'
  | 'LUMP_SUM'

export type BeneficiaryType = 'WORKER' | 'CONTRACTOR' | 'CREW' | 'RECIPIENT'

export interface AdvanceState {
  amount: Cents
  recovered: Cents
  status: AdvanceStatus
}

/** Saldo pendiente. Nunca negativo: recuperar de más sería un error, no un saldo. */
export function balanceOf(state: Pick<AdvanceState, 'amount' | 'recovered'>): Cents {
  const balance = subtract(state.amount, state.recovered)
  return balance < ZERO ? ZERO : balance
}

/** Cuánto se ha recuperado, en porcentaje entero de 0 a 100. */
export function progressOf(state: Pick<AdvanceState, 'amount' | 'recovered'>): number {
  if (state.amount === ZERO) return 100
  const pct = Number((state.recovered * 100n) / state.amount)
  return Math.max(0, Math.min(100, pct))
}

/**
 * El estado que le corresponde a un préstamo según lo recuperado.
 *
 * Se calcula, no se escribe a mano: un estado escrito a mano puede decir
 * «pagado» con saldo pendiente.
 */
export function statusFor(state: AdvanceState): AdvanceStatus {
  if (state.status === 'CANCELLED' || state.status === 'PENDING') return state.status
  if (state.recovered === ZERO) return 'ACTIVE'
  if (balanceOf(state) === ZERO) return 'PAID'
  return 'PARTIALLY_RECOVERED'
}

export interface RecoveryPlan {
  method: RecoveryMethod
  /** Monto fijo por período, para FIXED_WEEKLY. */
  fixedAmount: Cents | null
  /** Porcentaje del neto, para los métodos por porcentaje. */
  percent: string | null
  /** Tope por período, para PERCENTAGE_WITH_CAP. */
  cap: Cents | null
}

export interface RecoverySuggestion {
  amount: Cents
  /** Por qué es ese monto, en español, para mostrarlo junto al descuento. */
  why: string
  /** `true` cuando el saldo era menor que lo que decía el plan. */
  limitedByBalance: boolean
}

/**
 * Cuánto descontar esta semana, según el plan y el neto disponible.
 *
 * Devuelve `null` cuando el método es manual o de una sola vez: esos no los
 * decide el sistema. Inventar un monto en un plan manual es exactamente lo que
 * no debe pasar.
 */
export function suggestRecovery(
  plan: RecoveryPlan,
  balance: Cents,
  netPay: Cents,
): RecoverySuggestion | null {
  if (balance === ZERO) return null

  let raw: Cents
  let why: string

  switch (plan.method) {
    case 'FIXED_WEEKLY':
      if (plan.fixedAmount === null) return null
      raw = plan.fixedAmount
      why = `Plan: $${toDecimalString(plan.fixedAmount)} por período.`
      break

    case 'PERCENTAGE_OF_NET':
      if (plan.percent === null) return null
      raw = percentage(netPay, plan.percent)
      why = `Plan: ${plan.percent}% del neto ($${toDecimalString(netPay)}).`
      break

    case 'PERCENTAGE_WITH_CAP': {
      if (plan.percent === null) return null
      const byPercent = percentage(netPay, plan.percent)
      raw = plan.cap === null ? byPercent : min(byPercent, plan.cap)
      why =
        plan.cap !== null && byPercent > plan.cap
          ? `Plan: ${plan.percent}% del neto, con tope de $${toDecimalString(plan.cap)}.`
          : `Plan: ${plan.percent}% del neto ($${toDecimalString(netPay)}).`
      break
    }

    // Manual y pago único los decide una persona, no el sistema.
    case 'MANUAL':
    case 'LUMP_SUM':
      return null
  }

  // Nunca más de lo que se debe.
  const amount = min(raw, balance)
  return {
    amount,
    why:
      amount === balance && raw > balance
        ? `${why} Se limita a $${toDecimalString(balance)}, que es lo que queda por pagar.`
        : why,
    limitedByBalance: raw > balance,
  }
}

/** Suma de recuperaciones. Existe para que nadie la calcule por su cuenta. */
export function totalRecovered(amounts: Iterable<Cents>): Cents {
  let total = ZERO
  for (const amount of amounts) total = add(total, amount)
  return total
}

export const ESTADO_PRESTAMO: Record<AdvanceStatus, string> = {
  PENDING: 'Esperando aprobación',
  APPROVED: 'Aprobado, sin entregar',
  ACTIVE: 'Activo',
  PARTIALLY_RECOVERED: 'Pagando',
  PAID: 'Pagado',
  CANCELLED: 'Anulado',
}

export const METODO_RECUPERACION: Record<RecoveryMethod, string> = {
  FIXED_WEEKLY: 'Monto fijo por período',
  PERCENTAGE_OF_NET: 'Porcentaje del neto',
  PERCENTAGE_WITH_CAP: 'Porcentaje del neto, con tope',
  MANUAL: 'Manual, se decide cada vez',
  LUMP_SUM: 'Todo de una vez',
}

export const TIPO_BENEFICIARIO: Record<BeneficiaryType, string> = {
  WORKER: 'Trabajador',
  CONTRACTOR: 'Contratista',
  CREW: 'Cuadrilla',
  RECIPIENT: 'Empresa receptora',
}
