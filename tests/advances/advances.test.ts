/**
 * Préstamos: saldo y cuánto descontar.
 *
 * Lo que se prueba sobre todo es que NUNCA se descuente más de lo que se debe.
 * Cobrar de más es quitarle plata a alguien que ya pagó.
 */
import { describe, expect, it } from 'vitest'
import {
  balanceOf,
  progressOf,
  statusFor,
  suggestRecovery,
  totalRecovered,
  type RecoveryPlan,
} from '@/lib/advances'
import { toCents, toDecimalString } from '@/lib/payroll/engine/money'

const c = toCents
const d = toDecimalString

describe('saldo', () => {
  it('es lo prestado menos lo recuperado', () => {
    expect(d(balanceOf({ amount: c('300.00'), recovered: c('30.00') }))).toBe('270.00')
  })

  it('recuperar todo deja el saldo en cero', () => {
    expect(d(balanceOf({ amount: c('300.00'), recovered: c('300.00') }))).toBe('0.00')
  })

  it('nunca es negativo: recuperar de más es un error, no un saldo a favor', () => {
    expect(d(balanceOf({ amount: c('300.00'), recovered: c('350.00') }))).toBe('0.00')
  })

  it('el plan del ejemplo del negocio cuadra exacto', () => {
    // 300 prestado, descuentos de 30, 200 y 70.
    const recovered = totalRecovered([c('30.00'), c('200.00'), c('70.00')])
    expect(d(recovered)).toBe('300.00')
    expect(d(balanceOf({ amount: c('300.00'), recovered }))).toBe('0.00')
  })
})

describe('avance', () => {
  it('va de 0 a 100', () => {
    expect(progressOf({ amount: c('300.00'), recovered: c('0') })).toBe(0)
    expect(progressOf({ amount: c('300.00'), recovered: c('150.00') })).toBe(50)
    expect(progressOf({ amount: c('300.00'), recovered: c('300.00') })).toBe(100)
  })

  it('un préstamo de cero no revienta', () => {
    expect(progressOf({ amount: c('0'), recovered: c('0') })).toBe(100)
  })
})

describe('estado', () => {
  const base = { amount: c('300.00'), status: 'ACTIVE' as const }

  it('sin abonos está activo', () => {
    expect(statusFor({ ...base, recovered: c('0') })).toBe('ACTIVE')
  })

  it('con abonos parciales está pagando', () => {
    expect(statusFor({ ...base, recovered: c('100.00') })).toBe('PARTIALLY_RECOVERED')
  })

  it('sin saldo queda pagado', () => {
    expect(statusFor({ ...base, recovered: c('300.00') })).toBe('PAID')
  })

  it('anulado y sin aprobar no cambian solos', () => {
    expect(statusFor({ ...base, recovered: c('100.00'), status: 'CANCELLED' })).toBe('CANCELLED')
    expect(statusFor({ ...base, recovered: c('0'), status: 'PENDING' })).toBe('PENDING')
  })
})

// ─────────────────────────────────────────────────────────────

function plan(over: Partial<RecoveryPlan> = {}): RecoveryPlan {
  return { method: 'FIXED_WEEKLY', fixedAmount: c('30.00'), percent: null, cap: null, ...over }
}

describe('cuánto descontar esta semana', () => {
  it('monto fijo: descuenta lo pactado', () => {
    const s = suggestRecovery(plan(), c('300.00'), c('1000.00'))
    expect(d(s!.amount)).toBe('30.00')
    expect(s!.limitedByBalance).toBe(false)
  })

  it('NUNCA descuenta más de lo que se debe', () => {
    // El plan dice 200 pero solo quedan 50.
    const s = suggestRecovery(plan({ fixedAmount: c('200.00') }), c('50.00'), c('1000.00'))
    expect(d(s!.amount)).toBe('50.00')
    expect(s!.limitedByBalance).toBe(true)
    expect(s!.why).toContain('Se limita a $50.00')
  })

  it('sin saldo no propone nada', () => {
    expect(suggestRecovery(plan(), c('0'), c('1000.00'))).toBeNull()
  })

  it('porcentaje del neto', () => {
    const s = suggestRecovery(
      plan({ method: 'PERCENTAGE_OF_NET', percent: '10', fixedAmount: null }),
      c('300.00'),
      c('1000.00'),
    )
    expect(d(s!.amount)).toBe('100.00')
  })

  it('porcentaje con tope: manda el tope cuando el porcentaje se pasa', () => {
    const s = suggestRecovery(
      plan({ method: 'PERCENTAGE_WITH_CAP', percent: '50', cap: c('200.00'), fixedAmount: null }),
      c('900.00'),
      c('1000.00'),
    )
    expect(d(s!.amount)).toBe('200.00')
    expect(s!.why).toContain('tope')
  })

  it('porcentaje con tope: manda el porcentaje cuando no llega al tope', () => {
    const s = suggestRecovery(
      plan({ method: 'PERCENTAGE_WITH_CAP', percent: '5', cap: c('200.00'), fixedAmount: null }),
      c('900.00'),
      c('1000.00'),
    )
    expect(d(s!.amount)).toBe('50.00')
  })

  it('el porcentaje también respeta el saldo', () => {
    const s = suggestRecovery(
      plan({ method: 'PERCENTAGE_OF_NET', percent: '50', fixedAmount: null }),
      c('40.00'),
      c('1000.00'),
    )
    expect(d(s!.amount)).toBe('40.00')
  })

  it('manual NO propone nada: lo decide una persona', () => {
    expect(suggestRecovery(plan({ method: 'MANUAL' }), c('300.00'), c('1000.00'))).toBeNull()
  })

  it('pago único tampoco lo decide el sistema', () => {
    expect(suggestRecovery(plan({ method: 'LUMP_SUM' }), c('300.00'), c('1000.00'))).toBeNull()
  })

  it('un plan incompleto no inventa un monto', () => {
    expect(suggestRecovery(plan({ fixedAmount: null }), c('300.00'), c('1000.00'))).toBeNull()
    expect(
      suggestRecovery(plan({ method: 'PERCENTAGE_OF_NET', percent: null }), c('300.00'), c('1000.00')),
    ).toBeNull()
  })

  it('el motivo explica el monto en español', () => {
    const s = suggestRecovery(plan(), c('300.00'), c('1000.00'))
    expect(s!.why).toContain('$30.00 por período')
  })

  it('los centavos no se pierden en el porcentaje', () => {
    const s = suggestRecovery(
      plan({ method: 'PERCENTAGE_OF_NET', percent: '33.33', fixedAmount: null }),
      c('10000.00'),
      c('333.33'),
    )
    expect(d(s!.amount)).toBe('111.10')
  })
})
