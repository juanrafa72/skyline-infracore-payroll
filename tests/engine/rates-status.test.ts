import { describe, expect, it } from 'vitest'
import { explainMissingRate, toCents } from '@/lib/payroll/engine'
import type { RateInput, WorkEntryInput } from '@/lib/payroll/engine/types'
import { rateTypeFor } from '@/lib/payroll/rates-status'

/**
 * La pantalla de tarifas faltantes usa la MISMA vara del motor. Estas pruebas
 * fijan las dos piezas puras de las que depende: qué tipo de tarifa necesita
 * cada forma de pago, y el diagnóstico de por qué una tarifa no aplica.
 */

describe('rateTypeFor', () => {
  it('mapea las tres formas de pago que llevan tarifa', () => {
    expect(rateTypeFor('DAILY_RATE')).toBe('DAILY')
    expect(rateTypeFor('HOURLY')).toBe('HOURLY')
    expect(rateTypeFor('FIXED_WEEKLY')).toBe('WEEKLY')
  })

  it('las formas sin tarifa de costo devuelven null — no se cuentan como faltantes', () => {
    expect(rateTypeFor('PRODUCTION')).toBeNull()
    expect(rateTypeFor('PIECE_RATE')).toBeNull()
    expect(rateTypeFor('PERCENTAGE')).toBeNull()
    expect(rateTypeFor('CONTRACTOR_SETTLEMENT')).toBeNull()
    expect(rateTypeFor('MANUAL')).toBeNull()
  })
})

function rate(overrides: Partial<RateInput>): RateInput {
  return {
    id: 'r1',
    rateType: 'DAILY',
    amount: toCents('180.00'),
    shift: 'ANY',
    projectId: null,
    operationId: null,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...overrides,
  }
}

function entry(overrides: Partial<WorkEntryInput>): WorkEntryInput {
  return {
    id: 'e1',
    workDate: '2026-08-10',
    dayType: 'FULL_DAY',
    hoursWorked: null,
    shift: 'DAY',
    projectId: null,
    crewId: null,
    operationId: null,
    ...overrides,
  }
}

describe('explainMissingRate (exportada para la pantalla de tarifas)', () => {
  it('sin ninguna tarifa lo dice directo', () => {
    expect(explainMissingRate([], entry({}), false)).toContain('ninguna tarifa registrada')
  })

  it('distingue tener tarifa de otro tipo', () => {
    const why = explainMissingRate([rate({ rateType: 'HOURLY' })], entry({}), false)
    expect(why).toContain('no diaria')
  })

  it('distingue una tarifa vencida y muestra sus vigencias', () => {
    const why = explainMissingRate(
      [rate({ effectiveFrom: '2026-01-01', effectiveTo: '2026-02-01' })],
      entry({ workDate: '2026-08-10' }),
      false,
    )
    expect(why).toContain('no estaba vigente')
    expect(why).toContain('2026-01-01')
  })

  it('la vigencia con effectiveTo es EXCLUSIVA: ese mismo día ya no aplica', () => {
    const why = explainMissingRate(
      [rate({ effectiveFrom: '2026-01-01', effectiveTo: '2026-08-10' })],
      entry({ workDate: '2026-08-10' }),
      false,
    )
    expect(why).toContain('no estaba vigente')
  })

  it('distingue tarifa amarrada a otra operación', () => {
    const why = explainMissingRate(
      [rate({ operationId: 'op-otra' })],
      entry({ operationId: 'op-mia' }),
      false,
    )
    expect(why).toContain('otra operación')
  })

  it('distingue tarifa amarrada a otro proyecto', () => {
    const why = explainMissingRate(
      [rate({ projectId: 'p-otro' })],
      entry({ projectId: 'p-mio' }),
      false,
    )
    expect(why).toContain('otro proyecto')
  })

  it('distingue tarifa de otro turno', () => {
    const why = explainMissingRate([rate({ shift: 'NIGHT' })], entry({ shift: 'DAY' }), false)
    expect(why).toContain('otro turno')
  })
})
