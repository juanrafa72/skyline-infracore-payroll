import { describe, expect, it } from 'vitest'
import {
  calculateContractorWeek,
  describeDifference,
  memberAmount,
} from '@/lib/payroll/contractors'
import { toCents, toDecimalString, unitPriceTotal } from '@/lib/payroll/engine/money'

/**
 * La semana de un contratista, con el ejemplo que dio el negocio:
 * Hugo trabajó a $0.30 el pie, construyó 10.000 pies, tiene gente a cargo, y
 * lo que sumen todos tiene que cuadrar con lo que dice SharePoint.
 */

const money = (c: ReturnType<typeof toCents>) => toDecimalString(c)

describe('el ejemplo de Hugo', () => {
  it('10.000 pies a $0.30 son $3.000,00', () => {
    const r = calculateContractorWeek({
      production: [{ quantity: '10000', price: '0.30' }],
      members: [],
    })
    expect(money(r.productionTotal)).toBe('3000.00')
  })

  it('el desglose de su gente más su parte cuadra con lo que dice la fuente', () => {
    const r = calculateContractorWeek({
      production: [{ quantity: '10000', price: '0.50' }],
      members: [
        { name: 'Francisco', rateAmount: '1200.00', quantity: '1' },
        { name: 'Juan', rateAmount: '1100.00', quantity: '1' },
        { name: 'Eduardo', rateAmount: '1000.00', quantity: '1' },
        { name: 'Hugo', rateAmount: '1700.00', quantity: '1', isContractor: true },
      ],
      expectedTotal: '5000.00',
    })

    expect(money(r.membersTotal)).toBe('3300.00')
    expect(money(r.contractorShare)).toBe('1700.00')
    expect(money(r.breakdownTotal)).toBe('5000.00')
    expect(r.status).toBe('CUADRA')
    expect(money(r.difference!)).toBe('0.00')
  })

  it('si no cuadra, la diferencia se MUESTRA — nunca se tapa', () => {
    const r = calculateContractorWeek({
      production: [{ quantity: '10000', price: '0.50' }],
      members: [
        { name: 'Francisco', rateAmount: '1200.00', quantity: '1' },
        { name: 'Hugo', rateAmount: '1700.00', quantity: '1', isContractor: true },
      ],
      expectedTotal: '5000.00',
    })

    expect(r.status).toBe('DIFERENCIA')
    expect(money(r.difference!)).toBe('2100.00')
    expect(r.message).toContain('faltan $2100.00')
  })

  it('sin desglose avisa que falta, en vez de dar la conciliación por buena', () => {
    const r = calculateContractorWeek({
      production: [{ quantity: '10000', price: '0.30' }],
      members: [],
      expectedTotal: '5000.00',
    })
    expect(r.status).toBe('SIN_DESGLOSE')
    expect(r.message).toContain('faltan $2000.00')
  })

  it('sin tecleer lo de la fuente no inventa una conciliación', () => {
    const r = calculateContractorWeek({
      production: [{ quantity: '10000', price: '0.30' }],
      members: [{ name: 'Hugo', rateAmount: '3000.00', quantity: '1', isContractor: true }],
    })
    expect(r.status).toBe('SIN_CONCILIAR')
    expect(r.expectedTotal).toBeNull()
    expect(r.difference).toBeNull()
  })

  it('la tarifa se puede cambiar y la cuenta cambia con ella', () => {
    const antes = calculateContractorWeek({
      production: [{ quantity: '10000', price: '0.30' }],
      members: [],
    })
    const despues = calculateContractorWeek({
      production: [{ quantity: '10000', price: '0.35' }],
      members: [],
    })
    expect(money(antes.productionTotal)).toBe('3000.00')
    expect(money(despues.productionTotal)).toBe('3500.00')
  })

  it('varios proyectos en la misma semana se suman', () => {
    const r = calculateContractorWeek({
      production: [
        { quantity: '10000', price: '0.30', projectName: 'DUBLIN' },
        { quantity: '4000', price: '0.45', projectName: 'SELMER_TN' },
      ],
      members: [],
    })
    // 3.000 + 1.800
    expect(money(r.productionTotal)).toBe('4800.00')
  })
})

describe('el precio por pie con 4 decimales', () => {
  it('$0.3025 sobre 10.000 pies son $3.025,00 — no se redondea la tarifa', () => {
    expect(money(unitPriceTotal('10000', '0.3025'))).toBe('3025.00')
  })

  it('redondear la tarifa a 2 decimales se llevaría $25 por delante', () => {
    const exacto = unitPriceTotal('10000', '0.3025')
    const redondeado = unitPriceTotal('10000', '0.30')
    expect(Number(money(exacto)) - Number(money(redondeado))).toBe(25)
  })

  it('un precio bajito como $0.075 el pie funciona', () => {
    expect(money(unitPriceTotal('10000', '0.075'))).toBe('750.00')
  })

  it('el redondeo a centavos ocurre UNA vez, sobre el resultado', () => {
    // 3 pies × $0.3333 = $0.9999 → $1.00
    expect(money(unitPriceTotal('3', '0.3333'))).toBe('1.00')
  })

  it('más de 4 decimales es un error, no un redondeo callado', () => {
    expect(() => unitPriceTotal('100', '0.30255')).toThrow(/4 decimales/)
  })

  it('cantidades con decimales también sirven', () => {
    expect(money(unitPriceTotal('1500.50', '0.30'))).toBe('450.15')
  })
})

describe('renglones del desglose', () => {
  it('una tarifa semanal es tarifa × 1', () => {
    expect(money(memberAmount({ name: 'Juan', rateAmount: '1100.00', quantity: '1' }))).toBe(
      '1100.00',
    )
  })

  it('una tarifa diaria se multiplica por los días', () => {
    expect(money(memberAmount({ name: 'Juan', rateAmount: '190.00', quantity: '5' }))).toBe(
      '950.00',
    )
  })

  it('alguien de la gente de Hugo también puede cobrar por pie', () => {
    expect(
      money(memberAmount({ name: 'Francisco', rateAmount: '0.12', quantity: '10000' })),
    ).toBe('1200.00')
  })
})

describe('cómo se le cuenta la diferencia al usuario', () => {
  it('dice «faltan» cuando la fuente pide más de lo calculado', () => {
    expect(describeDifference(toCents('250.00'))).toBe('faltan $250.00')
  })

  it('dice «sobran» cuando lo calculado se pasa', () => {
    expect(describeDifference(toCents('-80.00'))).toBe('sobran $80.00')
  })

  it('sin diferencia lo dice sin cifras', () => {
    expect(describeDifference(toCents('0'))).toBe('sin diferencia')
  })
})
