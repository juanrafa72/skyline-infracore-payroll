import { describe, expect, it } from 'vitest'
import { crewDailyTotal, sumProductionAmounts } from '@/lib/payroll/engine/payables'
import { crewDetail } from '@/lib/disbursement/detail'
import { toCents, toDecimalString } from '@/lib/payroll/engine/money'
import { crewCalculationHash } from '@/lib/payroll/workflow'

/**
 * Una cuadrilla puede cobrar por pie construido O un precio fijo por día.
 * En los dos casos se le paga al contratista y se le lleva su nómina interna:
 * lo que cambia es de dónde sale el total.
 */

const money = (c: ReturnType<typeof toCents>) => toDecimalString(c)

describe('cuánto se le debe a una cuadrilla que cobra por día', () => {
  it('5 días a $800 son $4.000', () => {
    expect(money(crewDailyTotal(5, toCents('800.00')))).toBe('4000.00')
  })

  it('un solo día', () => {
    expect(money(crewDailyTotal(1, toCents('800.00')))).toBe('800.00')
  })

  it('sin días trabajados no se le debe nada', () => {
    expect(money(crewDailyTotal(0, toCents('800.00')))).toBe('0.00')
  })

  it('una tarifa con centavos no pierde precisión', () => {
    expect(money(crewDailyTotal(3, toCents('833.33')))).toBe('2499.99')
  })

  it('días negativos son un error, no un descuento', () => {
    expect(() => crewDailyTotal(-1, toCents('800.00'))).toThrow(/negativos/)
  })
})

describe('los dos modos dan cuentas distintas', () => {
  it('la misma semana rinde distinto según cómo cobre', () => {
    // Por producción: 10.000 pies a $0.30.
    const porProduccion = sumProductionAmounts(['3000.00'])
    // Por día: 5 días a $800.
    const porDia = crewDailyTotal(5, toCents('800.00'))

    expect(money(porProduccion)).toBe('3000.00')
    expect(money(porDia)).toBe('4000.00')
  })
})

describe('contra qué se le paga, en el desprendible', () => {
  it('por producción dice los registros', () => {
    expect(crewDetail(3, 'PRODUCTION')).toBe('3 registros de producción')
    expect(crewDetail(1, 'PRODUCTION')).toBe('1 registro de producción')
  })

  it('por día dice los días y la tarifa', () => {
    // Decir «registros de producción» en una cuadrilla que cobra por día haría
    // buscar una producción que no existe.
    expect(crewDetail(5, 'DAILY', '800.00')).toBe('5 días × $800.00')
    expect(crewDetail(1, 'DAILY', '800.00')).toBe('1 día × $800.00')
  })

  it('por día sin tarifa todavía, dice al menos los días', () => {
    expect(crewDetail(5, 'DAILY', null)).toBe('5 días')
  })

  it('sin decir el modo se comporta como antes', () => {
    expect(crewDetail(3)).toBe('3 registros de producción')
  })
})

describe('la huella de aprobación', () => {
  const base = {
    crewId: 'c1',
    contractorId: 'hugo',
    production: [],
    billingMode: 'DAILY',
    days: ['2026-08-10', '2026-08-11'],
    appliedDailyRate: '800.00',
    total: '1600.00',
  }

  it('cambiar un día tumba la aprobación', () => {
    const antes = crewCalculationHash(base)
    const despues = crewCalculationHash({ ...base, days: ['2026-08-10'], total: '800.00' })
    expect(antes).not.toBe(despues)
  })

  it('cambiar la tarifa diaria tumba la aprobación', () => {
    const antes = crewCalculationHash(base)
    const despues = crewCalculationHash({ ...base, appliedDailyRate: '900.00' })
    expect(antes).not.toBe(despues)
  })

  it('cambiar el modo de cobro tumba la aprobación', () => {
    const antes = crewCalculationHash(base)
    const despues = crewCalculationHash({ ...base, billingMode: 'PRODUCTION' })
    expect(antes).not.toBe(despues)
  })

  it('el orden de los días no cambia la huella: son un conjunto', () => {
    const a = crewCalculationHash(base)
    const b = crewCalculationHash({ ...base, days: ['2026-08-11', '2026-08-10'] })
    expect(a).toBe(b)
  })

  it('una liquidación de producción sin días sigue dando la misma huella', () => {
    // Las de antes no tenían estos campos: su huella no puede haber cambiado.
    const vieja = { crewId: 'c1', contractorId: 'x', production: [], total: '100.00' }
    expect(crewCalculationHash(vieja)).toBe(
      crewCalculationHash({ ...vieja, billingMode: 'PRODUCTION', days: [], appliedDailyRate: null }),
    )
  })
})
