/**
 * PayrollEngine — toda la matemática de dinero del sistema.
 *
 * Propiedades garantizadas (BR-054):
 *  - PURO: no consulta la base de datos, no lee el reloj, no usa aleatoriedad.
 *  - DETERMINISTA: la misma entrada produce siempre la misma salida.
 *  - AUDITABLE: devuelve la traza de cada concepto.
 *
 * Orden de cálculo (BR-050), sin excepciones:
 *   basePay → additions → grossPay → deductions(prioridad) → netPay
 */
import {
  ZERO,
  add,
  isNegative,
  min,
  multiplyQuantity,
  percentage,
  quantityToHundredths,
  subtract,
  sum,
  toDecimalString,
  type Cents,
} from './money'
import { resolveRate } from './rates'
import type {
  AdditionInput,
  AdvanceInput,
  RateInput,
  CalculatedDeduction,
  CalculatedLine,
  CalculationInput,
  CalculationResult,
  DebtInput,
  EngineException,
  WorkEntryInput,
} from './types'

export * from './money'
export * from './types'
export { resolveRate } from './rates'

export function calculateWorkerPayroll(input: CalculationInput): CalculationResult {
  const exceptions: EngineException[] = []

  const base = calculateBasePay(input, exceptions)

  // Los adicionales capturados día por día entran como adicionales normales.
  // Se capturan en la rejilla porque es cuando se sabe, pero contablemente son
  // lo mismo que un adicional de la semana.
  const dailyAdditions = additionsFromEntries(input.entries, exceptions)
  const allAdditions = [...input.additions, ...dailyAdditions]
  const additionsTotal = sum(allAdditions.map((addition) => addition.amount))
  const grossPay = calculateGrossPay(base.basePay, additionsTotal)

  const deductions = calculateDeductions(input, grossPay, exceptions)
  const deductionsTotal = sum(deductions.map((d) => d.amount))

  const rawNet = calculateNetPay(grossPay, deductionsTotal)

  let netPay = rawNet
  let carriedForward = ZERO

  if (isNegative(rawNet)) {
    exceptions.push({
      code: 'NEGATIVE_PAYROLL',
      level: 'CRITICAL',
      title: 'Neto negativo',
      detail:
        `Los descuentos (${toDecimalString(deductionsTotal)}) superan el bruto ` +
        `(${toDecimalString(grossPay)}).`,
    })
    if (input.settings.negativeNetBehavior === 'CLAMP_AND_CARRY') {
      carriedForward = subtract(ZERO, rawNet)
      netPay = ZERO
    }
  }

  return {
    workerId: input.workerId,
    daysFull: base.daysFull,
    daysHalf: base.daysHalf,
    daysNoWork: base.daysNoWork,
    hoursTotal: base.hoursTotal,
    lines: base.lines,
    additions: allAdditions,
    deductions,
    basePay: base.basePay,
    additionsTotal,
    grossPay,
    deductionsTotal,
    netPay,
    carriedForward,
    exceptions,
  }
}

// ─────────────────────────────────────────────────────────────
// Pago base
// ─────────────────────────────────────────────────────────────

interface BaseResult {
  lines: CalculatedLine[]
  basePay: Cents
  daysFull: number
  daysHalf: number
  daysNoWork: number
  hoursTotal: string
}

export function calculateBasePay(
  input: CalculationInput,
  exceptions: EngineException[],
): BaseResult {
  const lines: CalculatedLine[] = []
  let daysFull = 0
  let daysHalf = 0
  let daysNoWork = 0
  let hoursHundredths = 0n

  if (input.compensationType === 'FIXED_WEEKLY') {
    const amount = input.fixedWeeklyAmount ?? ZERO
    if (input.fixedWeeklyAmount === null) {
      exceptions.push({
        code: 'MISSING_RATE',
        level: 'CRITICAL',
        title: 'Falta la tarifa semanal fija',
        detail: 'El trabajador es de pago semanal fijo pero no tiene monto configurado.',
      })
    }
    for (const entry of input.entries) countDay(entry, () => (daysFull += 1), () => (daysHalf += 1), () => (daysNoWork += 1))
    lines.push({
      workEntryId: null,
      lineType: 'BASE_WEEKLY',
      workDate: null,
      quantity: '1',
      appliedRate: amount,
      rateSourceId: null,
      amount,
      projectId: null,
      crewId: null,
      shift: 'DAY',
      description: 'Pago semanal fijo',
    })
    return { lines, basePay: amount, daysFull, daysHalf, daysNoWork, hoursTotal: '0.00' }
  }

  for (const entry of [...input.entries].sort((a, b) => a.workDate.localeCompare(b.workDate))) {
    countDay(entry, () => (daysFull += 1), () => (daysHalf += 1), () => (daysNoWork += 1))

    if (entry.dayType === 'NO_WORK' && !input.settings.payNoWorkDays) continue
    if (entry.dayType === 'OTHER') continue

    const isHourly = entry.dayType === 'HOURLY'
    const rate = resolveRate(input.rates, {
      workDate: entry.workDate,
      rateType: isHourly ? 'HOURLY' : 'DAILY',
      shift: entry.shift,
      projectId: entry.projectId,
      operationId: entry.operationId,
    })

    if (rate === null) {
      // BR-033: nunca se paga cero en silencio. Y el aviso tiene que decir por
      // qué no aplicó: "no hay tarifa" y "tiene tarifa pero no le sirve a este
      // día" se arreglan de formas distintas.
      exceptions.push({
        code: 'MISSING_RATE',
        level: 'CRITICAL',
        title: 'Sin tarifa para este día',
        detail: explainMissingRate(input.rates, entry, isHourly),
        workDate: entry.workDate,
      })
      continue
    }

    if (isHourly) {
      const hours = entry.hoursWorked ?? '0'
      hoursHundredths += quantityToHundredths(hours)
      const amount = multiplyQuantity(rate.amount, hours)
      lines.push(makeLine(entry, 'BASE_HOURLY', hours, rate.amount, rate.id, amount, `${hours} h`))
      continue
    }

    const factor =
      entry.dayType === 'HALF_DAY' ? input.settings.halfDayFactor : entry.dayType === 'FULL_DAY' ? '1' : '0'
    const amount = multiplyQuantity(rate.amount, factor)
    const lineType = entry.dayType === 'HALF_DAY' ? 'BASE_HALF_DAY' : 'BASE_DAY'
    const label = entry.dayType === 'HALF_DAY' ? 'Medio día' : entry.dayType === 'FULL_DAY' ? 'Día completo' : 'Día no trabajado'
    lines.push(makeLine(entry, lineType, factor, rate.amount, rate.id, amount, label))
  }

  return {
    lines,
    basePay: sum(lines.map((line) => line.amount)),
    daysFull,
    daysHalf,
    daysNoWork,
    hoursTotal: hundredthsToString(hoursHundredths),
  }
}

/**
 * Explica en cristiano por qué ninguna tarifa aplicó a este día.
 *
 * Exportada porque la pantalla de tarifas faltantes muestra el mismo motivo:
 * si el diagnóstico se escribiera dos veces, tarde o temprano dirían cosas
 * distintas sobre el mismo trabajador.
 */
export function explainMissingRate(
  rates: readonly RateInput[],
  entry: WorkEntryInput,
  isHourly: boolean,
): string {
  const kind = isHourly ? 'por hora' : 'diaria'

  if (rates.length === 0) {
    return `No tiene ninguna tarifa registrada. Hay que ponerle una antes de calcular el ${entry.workDate}.`
  }

  const ofKind = rates.filter((rate) => rate.rateType === (isHourly ? 'HOURLY' : 'DAILY'))
  if (ofKind.length === 0) {
    return `Tiene tarifa, pero no ${kind}. El día está marcado como ${isHourly ? 'por horas' : 'día completo o medio'}.`
  }

  const vigentes = ofKind.filter(
    (rate) =>
      rate.effectiveFrom <= entry.workDate &&
      (rate.effectiveTo === null || rate.effectiveTo > entry.workDate),
  )
  if (vigentes.length === 0) {
    const fechas = ofKind
      .map((rate) => `${rate.effectiveFrom}${rate.effectiveTo ? ` a ${rate.effectiveTo}` : ' en adelante'}`)
      .join(', ')
    return `Su tarifa ${kind} no estaba vigente el ${entry.workDate}. Vigencias: ${fechas}.`
  }

  const porOperacion = vigentes.filter(
    (rate) => rate.operationId !== null && rate.operationId !== entry.operationId,
  )
  if (porOperacion.length === vigentes.length) {
    if (entry.operationId !== null) return 'Su tarifa es de otra operación distinta a la de este día.'
    return (
      `Tiene ${vigentes.length} tarifas de operaciones distintas y este día no dice a cuál ` +
      'corresponde. Asígnale la operación a la persona para que no quede a la interpretación.'
    )
  }

  const porProyecto = vigentes.filter(
    (rate) => rate.projectId !== null && rate.projectId !== entry.projectId,
  )
  if (porProyecto.length === vigentes.length) {
    return `Su tarifa está amarrada a otro proyecto distinto al de este día.`
  }

  const porTurno = vigentes.filter(
    (rate) => rate.shift !== 'ANY' && rate.shift !== entry.shift,
  )
  if (porTurno.length === vigentes.length) {
    return `Su tarifa es de otro turno. Este día está marcado como ${entry.shift === 'NIGHT' ? 'noche' : 'día'}.`
  }

  return `Ninguna de sus tarifas aplica al ${entry.workDate}.`
}

function countDay(
  entry: WorkEntryInput,
  onFull: () => void,
  onHalf: () => void,
  onNone: () => void,
): void {
  if (entry.dayType === 'FULL_DAY' || entry.dayType === 'HOURLY') onFull()
  else if (entry.dayType === 'HALF_DAY') onHalf()
  else if (entry.dayType === 'NO_WORK') onNone()
}

function makeLine(
  entry: WorkEntryInput,
  lineType: CalculatedLine['lineType'],
  quantity: string,
  appliedRate: Cents,
  rateSourceId: string,
  amount: Cents,
  description: string,
): CalculatedLine {
  return {
    workEntryId: entry.id,
    lineType,
    workDate: entry.workDate,
    quantity,
    appliedRate,
    rateSourceId,
    amount,
    projectId: entry.projectId,
    crewId: entry.crewId,
    shift: entry.shift === 'ANY' ? 'DAY' : entry.shift,
    description,
  }
}

function hundredthsToString(value: bigint): string {
  const negative = value < 0n
  const absolute = negative ? -value : value
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────
// Adicionales, bruto, descuentos, neto
// ─────────────────────────────────────────────────────────────

export function calculateAdditions(input: CalculationInput): Cents {
  return sum([
    ...input.additions.map((addition) => addition.amount),
    ...additionsFromEntries(input.entries, []).map((addition) => addition.amount),
  ])
}

/**
 * Convierte los adicionales marcados en la rejilla en adicionales de nómina.
 *
 * Un monto sin nota no se paga: se reporta como excepción. La base también lo
 * impide, pero el motor no confía en que el dato haya pasado por la base.
 */
function additionsFromEntries(
  entries: readonly WorkEntryInput[],
  exceptions: EngineException[],
): AdditionInput[] {
  const additions: AdditionInput[] = []

  for (const entry of entries) {
    const amount = entry.additionalAmount
    if (amount === undefined || amount === null || amount === ZERO) continue

    const note = entry.additionalNote?.trim()
    if (!note) {
      exceptions.push({
        code: 'UNUSUAL_ADDITION',
        level: 'CRITICAL',
        title: 'Adicional sin explicación',
        detail: `El ${entry.workDate} tiene un adicional de ${toDecimalString(amount)} sin nota. No se paga hasta que se explique.`,
        workDate: entry.workDate,
      })
      continue
    }

    additions.push({
      id: `entry-${entry.id}`,
      category: 'MANUAL_ADJUSTMENT',
      amount,
      description: `${entry.workDate}: ${note}`,
    })
  }

  return additions
}

export function calculateGrossPay(basePay: Cents, additionsTotal: Cents): Cents {
  return add(basePay, additionsTotal)
}

export function calculateNetPay(grossPay: Cents, deductionsTotal: Cents): Cents {
  return subtract(grossPay, deductionsTotal)
}

/**
 * Descuentos en orden de prioridad (BR-056):
 *   1. recuperación de anticipos
 *   2. recuperación de deudas
 *   3. descuentos manuales
 *
 * Las recuperaciones nunca exceden el saldo (BR-087) ni el disponible del bruto.
 */
export function calculateDeductions(
  input: CalculationInput,
  grossPay: Cents,
  exceptions: EngineException[],
): CalculatedDeduction[] {
  const deductions: CalculatedDeduction[] = []
  let available = grossPay

  for (const advance of input.advances) {
    if (advance.paused) continue
    const amount = calculateAdvanceRecovery(advance, grossPay, available)
    if (amount === ZERO) continue
    deductions.push({
      category: 'ADVANCE_RECOVERY',
      amount,
      description: `Recuperación de anticipo`,
      sourceType: 'ADVANCE_ENGINE',
      advanceId: advance.id,
    })
    available = subtract(available, amount)
  }

  for (const debt of input.debts) {
    if (debt.recoveryRule === 'PAUSED') continue
    const amount = calculateDebtRecovery(debt, grossPay, available)
    if (amount === ZERO) continue
    deductions.push({
      category: 'DEBT_RECOVERY',
      amount,
      description: `Recuperación de deuda`,
      sourceType: 'DEBT_ENGINE',
      debtId: debt.id,
    })
    available = subtract(available, amount)
  }

  for (const manual of input.manualDeductions) {
    deductions.push({
      category: manual.category,
      amount: manual.amount,
      description: manual.description,
      sourceType: 'MANUAL',
    })
    if (manual.amount > available && available >= ZERO) {
      exceptions.push({
        code: 'UNUSUAL_DEDUCTION',
        level: 'REVIEW_REQUIRED',
        title: 'Descuento mayor al disponible',
        detail: `El descuento "${manual.description}" (${toDecimalString(manual.amount)}) supera lo que queda por pagar.`,
      })
    }
    available = subtract(available, manual.amount)
  }

  return deductions
}

export function calculateAdvanceRecovery(
  advance: AdvanceInput,
  grossPay: Cents,
  available: Cents,
): Cents {
  return capRecovery(
    computeRecovery(
      advance.recoveryMethod === 'LUMP_SUM' ? 'FULL' : advance.recoveryMethod,
      advance.recoveryAmount,
      advance.recoveryPct,
      advance.recoveryCap,
      advance.balance,
      grossPay,
    ),
    advance.balance,
    available,
  )
}

export function calculateDebtRecovery(
  debt: DebtInput,
  grossPay: Cents,
  available: Cents,
): Cents {
  return capRecovery(
    computeRecovery(debt.recoveryRule, debt.recoveryAmount, debt.recoveryPct, debt.recoveryCap, debt.balance, grossPay),
    debt.balance,
    available,
  )
}

function computeRecovery(
  rule: string,
  amount: Cents | null,
  pct: string | null,
  cap: Cents | null,
  balance: Cents,
  grossPay: Cents,
): Cents {
  switch (rule) {
    case 'FULL':
      return balance
    case 'FIXED_WEEKLY':
      return amount ?? ZERO
    case 'PERCENTAGE_OF_NET':
      return pct === null ? ZERO : percentage(grossPay, pct)
    case 'PERCENTAGE_WITH_CAP': {
      if (pct === null) return ZERO
      const computed = percentage(grossPay, pct)
      return cap === null ? computed : min(computed, cap)
    }
    default: // MANUAL, PAUSED
      return ZERO
  }
}

/** La recuperación nunca supera el saldo ni lo disponible, y nunca es negativa. */
function capRecovery(requested: Cents, balance: Cents, available: Cents): Cents {
  if (requested <= ZERO) return ZERO
  const cappedByBalance = min(requested, balance)
  const cappedByAvailable = min(cappedByBalance, available)
  return cappedByAvailable <= ZERO ? ZERO : cappedByAvailable
}
