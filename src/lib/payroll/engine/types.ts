import type { Cents } from './money'

export type DayType = 'FULL_DAY' | 'HALF_DAY' | 'NO_WORK' | 'HOURLY' | 'OTHER'
export type Shift = 'DAY' | 'NIGHT' | 'ANY'
export type CompensationType =
  | 'DAILY_RATE'
  | 'HOURLY'
  | 'FIXED_WEEKLY'
  | 'PRODUCTION'
  | 'PIECE_RATE'
  | 'PERCENTAGE'
  | 'CONTRACTOR_SETTLEMENT'
  | 'MANUAL'

export type RateType = 'DAILY' | 'HOURLY' | 'WEEKLY' | 'PIECE' | 'PERCENTAGE'

/** Una tarifa vigente. Las fechas son `YYYY-MM-DD` para que el motor no toque el reloj. */
export interface RateInput {
  id: string
  rateType: RateType
  amount: Cents
  shift: Shift
  projectId: string | null
  operationId: string | null
  effectiveFrom: string
  effectiveTo: string | null
}

export interface WorkEntryInput {
  id: string
  workDate: string
  dayType: DayType
  hoursWorked: string | null
  shift: Shift
  projectId: string | null
  crewId: string | null
  operationId: string | null
}

export interface AdditionInput {
  id: string
  category: string
  amount: Cents
  description: string
}

export interface DeductionInput {
  id: string
  category: string
  amount: Cents
  description: string
}

/** Anticipo con su saldo ya calculado por el servicio (el motor no consulta la base). */
export interface AdvanceInput {
  id: string
  balance: Cents
  recoveryMethod: 'FIXED_WEEKLY' | 'PERCENTAGE_OF_NET' | 'PERCENTAGE_WITH_CAP' | 'MANUAL' | 'LUMP_SUM'
  recoveryAmount: Cents | null
  recoveryPct: string | null
  recoveryCap: Cents | null
  paused: boolean
}

export interface DebtInput {
  id: string
  balance: Cents
  recoveryRule: 'FIXED_WEEKLY' | 'PERCENTAGE_OF_NET' | 'PERCENTAGE_WITH_CAP' | 'MANUAL' | 'PAUSED'
  recoveryAmount: Cents | null
  recoveryPct: string | null
  recoveryCap: Cents | null
}

export interface PayrollSettings {
  /** A8 — factor del medio día. Por defecto '0.5'. */
  halfDayFactor: string
  /** A15 — ¿se pagan los días NO_WORK? Por defecto false. */
  payNoWorkDays: boolean
  /** A10 — qué hacer si el neto sale negativo. */
  negativeNetBehavior: 'CLAMP_AND_CARRY' | 'ALLOW_NEGATIVE'
}

export const DEFAULT_SETTINGS: PayrollSettings = {
  halfDayFactor: '0.5',
  payNoWorkDays: false,
  negativeNetBehavior: 'CLAMP_AND_CARRY',
}

export interface CalculationInput {
  workerId: string
  compensationType: CompensationType
  fixedWeeklyAmount: Cents | null
  entries: readonly WorkEntryInput[]
  rates: readonly RateInput[]
  additions: readonly AdditionInput[]
  manualDeductions: readonly DeductionInput[]
  advances: readonly AdvanceInput[]
  debts: readonly DebtInput[]
  settings: PayrollSettings
}

export type LineType =
  | 'BASE_DAY'
  | 'BASE_HALF_DAY'
  | 'BASE_HOURLY'
  | 'BASE_WEEKLY'
  | 'BASE_PRODUCTION'
  | 'BASE_PIECE'
  | 'BASE_PERCENTAGE'

export interface CalculatedLine {
  workEntryId: string | null
  lineType: LineType
  workDate: string | null
  quantity: string
  /** Snapshot de la tarifa aplicada — BR-032. */
  appliedRate: Cents
  rateSourceId: string | null
  amount: Cents
  projectId: string | null
  crewId: string | null
  shift: Shift
  description: string
}

export interface CalculatedDeduction {
  category: string
  amount: Cents
  description: string
  sourceType: 'MANUAL' | 'ADVANCE_ENGINE' | 'DEBT_ENGINE'
  advanceId?: string
  debtId?: string
}

export interface EngineException {
  code: string
  level: 'WARNING' | 'REVIEW_REQUIRED' | 'CRITICAL'
  title: string
  detail: string
  workDate?: string
}

export interface CalculationResult {
  workerId: string
  daysFull: number
  daysHalf: number
  daysNoWork: number
  hoursTotal: string
  lines: readonly CalculatedLine[]
  additions: readonly AdditionInput[]
  deductions: readonly CalculatedDeduction[]
  basePay: Cents
  additionsTotal: Cents
  grossPay: Cents
  deductionsTotal: Cents
  netPay: Cents
  /** Descuento que no cupo en el neto y pasa a la semana siguiente (A10). */
  carriedForward: Cents
  exceptions: readonly EngineException[]
}
