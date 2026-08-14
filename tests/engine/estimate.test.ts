/**
 * La suma que se ve mientras se marca la semana.
 *
 * Aunque solo alimente una barra en pantalla, es una cifra de dinero que
 * alguien va a mirar para decidir. Se prueba como cualquier otra.
 */
import { describe, expect, it } from 'vitest'
import { daysLabel, estimateWeek, type MarkedDays } from '@/lib/payroll/estimate'
import { ZERO, toCents, toDecimalString } from '@/lib/payroll/engine/money'

function person(over: Partial<MarkedDays> = {}): MarkedDays {
  return {
    workerId: 'w1',
    name: 'Persona',
    rate: toCents('200.00'),
    fullDays: 0,
    halfDays: 0,
    extra: ZERO,
    ...over,
  }
}

describe('días en texto', () => {
  it('cuenta enteros', () => {
    expect(daysLabel(5, 0)).toBe('5')
    expect(daysLabel(0, 0)).toBe('0')
  })

  it('dos medios días son uno completo', () => {
    expect(daysLabel(0, 2)).toBe('1')
    expect(daysLabel(4, 2)).toBe('5')
  })

  it('un medio suelto se muestra con ½', () => {
    expect(daysLabel(5, 1)).toBe('5½')
    expect(daysLabel(0, 1)).toBe('0½')
    expect(daysLabel(4, 3)).toBe('5½')
  })
})

describe('lo que va sumando la semana', () => {
  it('5 días a $200 son $1.000', () => {
    const e = estimateWeek([person({ fullDays: 5 })])
    expect(toDecimalString(e.grand)).toBe('1000.00')
    expect(e.daysLabel).toBe('5')
    expect(e.people).toBe(1)
  })

  it('medio día paga exactamente la mitad, sin arrastrar decimales', () => {
    const e = estimateWeek([person({ rate: toCents('333.33'), halfDays: 1 })])
    expect(toDecimalString(e.grand)).toBe('166.67')
  })

  it('suma los adicionales del día', () => {
    const e = estimateWeek([person({ fullDays: 2, extra: toCents('75.50') })])
    expect(toDecimalString(e.grand)).toBe('475.50')
    expect(toDecimalString(e.extra)).toBe('75.50')
  })

  it('suma varias personas', () => {
    const e = estimateWeek([
      person({ workerId: 'a', name: 'Ana', fullDays: 5 }),
      person({ workerId: 'b', name: 'Beto', rate: toCents('150.00'), fullDays: 3, halfDays: 1 }),
    ])
    // 1000 + (450 + 75)
    expect(toDecimalString(e.grand)).toBe('1525.00')
    expect(e.daysLabel).toBe('8½')
    expect(e.people).toBe(2)
  })

  it('quien no tiene tarifa NO suma cero: se avisa aparte', () => {
    const e = estimateWeek([
      person({ workerId: 'a', name: 'Ana', fullDays: 5 }),
      person({ workerId: 'b', name: 'Beto', rate: null, fullDays: 5 }),
    ])

    expect(toDecimalString(e.grand)).toBe('1000.00')
    expect(e.withoutRate).toEqual(['Beto'])
    // Pero sus días SÍ cuentan: trabajó.
    expect(e.daysLabel).toBe('10')
    expect(e.lines.find((line) => line.name === 'Beto')?.subtotal).toBeNull()
  })

  it('quien no tiene nada marcado no aparece en el detalle', () => {
    const e = estimateWeek([
      person({ workerId: 'a', name: 'Ana', fullDays: 5 }),
      person({ workerId: 'b', name: 'Beto' }),
    ])
    expect(e.people).toBe(1)
    expect(e.lines.map((line) => line.name)).toEqual(['Ana'])
  })

  it('una semana vacía da cero sin reventar', () => {
    const e = estimateWeek([])
    expect(toDecimalString(e.grand)).toBe('0.00')
    expect(e.daysLabel).toBe('0')
    expect(e.people).toBe(0)
    expect(e.withoutRate).toEqual([])
  })

  it('el detalle sale en orden alfabético', () => {
    const e = estimateWeek([
      person({ workerId: 'z', name: 'Zoe', fullDays: 1 }),
      person({ workerId: 'a', name: 'Ana', fullDays: 1 }),
      person({ workerId: 'm', name: 'Ñandú', fullDays: 1 }),
    ])
    expect(e.lines.map((line) => line.name)).toEqual(['Ana', 'Ñandú', 'Zoe'])
  })

  it('los centavos no se pierden con muchas personas', () => {
    const many = Array.from({ length: 97 }, (_, index) =>
      person({ workerId: `w${index}`, name: `P${index}`, rate: toCents('33.33'), fullDays: 1 }),
    )
    expect(toDecimalString(estimateWeek(many).grand)).toBe('3233.01')
  })

  it('alguien solo con adicional, sin días, también cuenta', () => {
    const e = estimateWeek([person({ extra: toCents('50.00') })])
    expect(toDecimalString(e.grand)).toBe('50.00')
    expect(e.people).toBe(1)
    expect(e.daysLabel).toBe('0')
  })
})
