/**
 * Venta, costo y margen.
 *
 * Es la cifra con la que se decide si un proyecto da plata. Estas pruebas
 * cubren sobre todo lo que NO debe pasar: que una venta desconocida se vuelva
 * cero, que un préstamo descontado infle el margen, o que un porcentaje salga
 * de una división por cero.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_MARGIN,
  computeMargin,
  marginPercentage,
  sumMargins,
  toView,
  type MarginDay,
} from '@/lib/margin'
import {
  explainMissingBillingRate,
  resolveBillingRate,
  type BillingRateInput,
} from '@/lib/margin/rates'
import { toCents, toDecimalString } from '@/lib/payroll/engine/money'

function day(date: string, revenue: string | null, cost: string): MarginDay {
  return { date, revenue: revenue === null ? null : toCents(revenue), cost: toCents(cost) }
}

describe('margen de un conjunto de días', () => {
  it('el ejemplo del negocio: 5 días a 600 de venta y 400 de costo', () => {
    const days = Array.from({ length: 5 }, (_, index) =>
      day(`2026-03-0${index + 1}`, '600.00', '400.00'),
    )
    const result = computeMargin(days)

    expect(toDecimalString(result.revenue)).toBe('3000.00')
    expect(toDecimalString(result.cost)).toBe('2000.00')
    expect(toDecimalString(result.margin)).toBe('1000.00')
    expect(result.marginPct).toBe('33.33')
    expect(result.complete).toBe(true)
  })

  it('el turno de noche se suma con su propia tarifa', () => {
    const result = computeMargin([
      day('2026-03-01', '600.00', '400.00'),
      day('2026-03-02', '660.00', '440.00'),
    ])
    expect(toDecimalString(result.revenue)).toBe('1260.00')
    expect(toDecimalString(result.margin)).toBe('420.00')
  })

  it('un día sin tarifa de venta NO cuenta como venta cero', () => {
    const result = computeMargin([
      day('2026-03-01', '600.00', '400.00'),
      day('2026-03-02', null, '400.00'),
    ])

    // La venta conocida es solo la del primer día.
    expect(toDecimalString(result.revenue)).toBe('600.00')
    expect(result.daysWithoutRevenue).toBe(1)
    expect(result.complete).toBe(false)
    // Y el porcentaje se calla: sería mentira.
    expect(result.marginPct).toBeNull()
  })

  it('avisa en español cuando la venta está incompleta', () => {
    const view = toView(computeMargin([day('2026-03-01', null, '400.00')]))
    expect(view.warning).toContain('1 día(s) sin tarifa de venta')
    expect(view.marginPct).toBeNull()
  })

  it('sin días no hay porcentaje, y no revienta', () => {
    const result = computeMargin([])
    expect(toDecimalString(result.revenue)).toBe('0.00')
    expect(result.marginPct).toBeNull()
    expect(result.complete).toBe(true)
  })

  it('un margen negativo se muestra tal cual, no se esconde', () => {
    const result = computeMargin([day('2026-03-01', '300.00', '400.00')])
    expect(toDecimalString(result.margin)).toBe('-100.00')
    expect(result.marginPct).toBe('-33.33')
  })

  it('los centavos no se pierden sumando muchos días', () => {
    const days = Array.from({ length: 97 }, (_, index) =>
      day(`2026-03-${String((index % 28) + 1).padStart(2, '0')}`, '33.33', '11.11'),
    )
    const result = computeMargin(days)
    expect(toDecimalString(result.revenue)).toBe('3233.01')
    expect(toDecimalString(result.cost)).toBe('1077.67')
    expect(toDecimalString(result.margin)).toBe('2155.34')
  })
})

describe('margen porcentual', () => {
  it('redondea una sola vez, al final', () => {
    expect(marginPercentage(toCents('3000.00'), toCents('1000.00'))).toBe('33.33')
    expect(marginPercentage(toCents('50000.00'), toCents('18000.00'))).toBe('36.00')
    expect(marginPercentage(toCents('100.00'), toCents('50.00'))).toBe('50.00')
  })

  it('venta en cero no es 0%, es una pregunta sin respuesta', () => {
    expect(marginPercentage(toCents('0'), toCents('0'))).toBeNull()
    expect(marginPercentage(toCents('0'), toCents('-400.00'))).toBeNull()
  })

  it('con la venta incompleta no responde', () => {
    expect(marginPercentage(toCents('600.00'), toCents('200.00'), false)).toBeNull()
  })
})

describe('sumar márgenes por cuadrilla o proyecto', () => {
  it('suma venta, costo y días faltantes', () => {
    const uno = computeMargin([day('2026-03-01', '600.00', '400.00')])
    const dos = computeMargin([day('2026-03-01', '660.00', '440.00')])
    const total = sumMargins([uno, dos])

    expect(toDecimalString(total.revenue)).toBe('1260.00')
    expect(toDecimalString(total.margin)).toBe('420.00')
    expect(total.complete).toBe(true)
  })

  it('si una parte está incompleta, el total también', () => {
    const buena = computeMargin([day('2026-03-01', '600.00', '400.00')])
    const coja = computeMargin([day('2026-03-02', null, '400.00')])
    const total = sumMargins([buena, coja])

    expect(total.complete).toBe(false)
    expect(total.daysWithoutRevenue).toBe(1)
    expect(total.marginPct).toBeNull()
  })

  it('sumar nada da el margen vacío', () => {
    expect(sumMargins([])).toEqual(EMPTY_MARGIN)
  })
})

// ─────────────────────────────────────────────────────────────

function rate(over: Partial<BillingRateInput> = {}): BillingRateInput {
  return {
    id: 'r1',
    customerId: 'cliente-1',
    projectId: null,
    operationId: null,
    crewId: null,
    shift: 'ANY',
    rateType: 'DAILY',
    amount: toCents('600.00'),
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...over,
  }
}

const lookup = {
  customerId: 'cliente-1',
  projectId: null,
  operationId: null,
  crewId: null,
  shift: 'DAY' as const,
  rateType: 'DAILY' as const,
  date: '2026-03-01',
}

describe('encontrar la tarifa de venta', () => {
  it('la general aplica cuando no hay nada más específico', () => {
    expect(resolveBillingRate([rate()], lookup)?.id).toBe('r1')
  })

  it('la de noche NO aplica a un día', () => {
    expect(resolveBillingRate([rate({ shift: 'NIGHT' })], lookup)).toBeNull()
  })

  it('escoge la de noche para un turno de noche', () => {
    const found = resolveBillingRate(
      [
        rate({ id: 'dia', shift: 'DAY', amount: toCents('600.00') }),
        rate({ id: 'noche', shift: 'NIGHT', amount: toCents('660.00') }),
      ],
      { ...lookup, shift: 'NIGHT' },
    )
    expect(found?.id).toBe('noche')
    expect(toDecimalString(found!.amount)).toBe('660.00')
  })

  it('la del proyecto le gana a la general', () => {
    const found = resolveBillingRate(
      [rate({ id: 'general' }), rate({ id: 'proyecto', projectId: 'p1' })],
      { ...lookup, projectId: 'p1' },
    )
    expect(found?.id).toBe('proyecto')
  })

  it('la de otro proyecto NO se usa', () => {
    expect(
      resolveBillingRate([rate({ projectId: 'otro' })], { ...lookup, projectId: 'p1' }),
    ).toBeNull()
  })

  it('una tarifa que ya venció no aplica', () => {
    expect(
      resolveBillingRate([rate({ effectiveTo: '2026-02-28' })], lookup),
    ).toBeNull()
  })

  it('una tarifa que todavía no empieza no aplica', () => {
    expect(
      resolveBillingRate([rate({ effectiveFrom: '2026-06-01' })], lookup),
    ).toBeNull()
  })

  it('subir la tarifa hoy no cambia una semana vieja', () => {
    const rates = [
      rate({ id: 'vieja', amount: toCents('600.00'), effectiveFrom: '2026-01-01', effectiveTo: '2026-02-28' }),
      rate({ id: 'nueva', amount: toCents('650.00'), effectiveFrom: '2026-03-01' }),
    ]
    expect(resolveBillingRate(rates, { ...lookup, date: '2026-02-15' })?.id).toBe('vieja')
    expect(resolveBillingRate(rates, { ...lookup, date: '2026-03-15' })?.id).toBe('nueva')
  })

  it('la de otro cliente NUNCA se usa', () => {
    expect(
      resolveBillingRate([rate({ customerId: 'otro-cliente' })], lookup),
    ).toBeNull()
  })

  it('sin cliente no hay venta', () => {
    expect(resolveBillingRate([rate()], { ...lookup, customerId: null })).toBeNull()
  })
})

describe('por qué no se encontró tarifa de venta', () => {
  it('dice si falta el cliente', () => {
    expect(explainMissingBillingRate([], { ...lookup, customerId: null })).toContain(
      'no tiene cliente',
    )
  })

  it('dice si el cliente no tiene ninguna', () => {
    expect(explainMissingBillingRate([], lookup)).toContain('ninguna tarifa de venta')
  })

  it('dice si ninguna está vigente ese día', () => {
    const why = explainMissingBillingRate([rate({ effectiveTo: '2026-02-01' })], lookup)
    expect(why).toContain('ninguna vigente el 2026-03-01')
  })

  it('dice si el problema es el turno', () => {
    const why = explainMissingBillingRate([rate({ shift: 'NIGHT' })], lookup)
    expect(why).toContain('turno de día')
  })

  it('dice si están amarradas a otro proyecto', () => {
    const why = explainMissingBillingRate([rate({ projectId: 'otro' })], {
      ...lookup,
      projectId: 'p1',
    })
    expect(why).toContain('otro proyecto')
  })
})
