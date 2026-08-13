import { describe, expect, it } from 'vitest'
import {
  ZERO,
  abs,
  add,
  cents,
  isNegative,
  isZero,
  max,
  min,
  multiplyQuantity,
  multiplyRatio,
  negate,
  percentage,
  quantityToHundredths,
  subtract,
  sum,
  toCents,
  toDecimalString,
  variance,
} from '@/lib/payroll/engine/money'

describe('toCents', () => {
  it('convierte importes con dos decimales', () => {
    expect(toCents('4180.90')).toBe(418090n)
    expect(toCents('4181.00')).toBe(418100n)
    expect(toCents('0.01')).toBe(1n)
  })

  it('acepta un decimal, cero decimales y separadores de miles', () => {
    expect(toCents('4180.9')).toBe(418090n)
    expect(toCents('4180')).toBe(418000n)
    expect(toCents('$4,180.90')).toBe(418090n)
    expect(toCents(' 130 ')).toBe(13000n)
  })

  it('conserva el signo negativo', () => {
    expect(toCents('-127.59')).toBe(-12759n)
  })

  it('rechaza más de dos decimales en vez de redondear en silencio', () => {
    expect(() => toCents('100.005')).toThrow(/más de 2 decimales/)
  })

  it('rechaza texto que no es un importe', () => {
    expect(() => toCents('YA SE PAGO')).toThrow(/no reconocido/)
    expect(() => toCents('')).toThrow(/no reconocido/)
  })

  it('acepta números que representan centavos exactos y rechaza el resto', () => {
    expect(toCents(4180.9)).toBe(418090n)
    expect(toCents(130)).toBe(13000n)
    expect(() => toCents(0.001)).toThrow(/centavos exactos/)
    expect(() => toCents(Number.POSITIVE_INFINITY)).toThrow(/no finito/)
  })

  it('devuelve tal cual un bigint ya en centavos', () => {
    expect(toCents(418090n)).toBe(418090n)
  })
})

describe('cents', () => {
  it('acepta enteros', () => {
    expect(cents(500)).toBe(500n)
    expect(cents(500n)).toBe(500n)
  })

  it('rechaza decimales, que serían una fracción de centavo', () => {
    expect(() => cents(500.5)).toThrow(/entero de centavos/)
  })
})

describe('toDecimalString', () => {
  it('siempre imprime dos decimales', () => {
    expect(toDecimalString(cents(418090))).toBe('4180.90')
    expect(toDecimalString(cents(5))).toBe('0.05')
    expect(toDecimalString(cents(100))).toBe('1.00')
    expect(toDecimalString(ZERO)).toBe('0.00')
  })

  it('imprime negativos correctamente', () => {
    expect(toDecimalString(cents(-12759))).toBe('-127.59')
    expect(toDecimalString(cents(-5))).toBe('-0.05')
  })
})

describe('operaciones básicas', () => {
  it('suma y resta sin pérdida', () => {
    expect(add(toCents('0.10'), toCents('0.20'))).toBe(toCents('0.30'))
    expect(subtract(toCents('4181.00'), toCents('4180.90'))).toBe(toCents('0.10'))
    expect(add()).toBe(ZERO)
  })

  it('suma una lista larga sin desviación', () => {
    const line = toCents('0.10')
    const total = sum(Array.from({ length: 1000 }, () => line))
    expect(toDecimalString(total)).toBe('100.00')
  })

  it('resta múltiples valores', () => {
    expect(subtract(toCents('100.00'), toCents('30.00'), toCents('20.00'))).toBe(
      toCents('50.00'),
    )
  })

  it('negate, abs, min, max, isZero, isNegative', () => {
    expect(negate(toCents('10.00'))).toBe(toCents('-10.00'))
    expect(abs(toCents('-10.00'))).toBe(toCents('10.00'))
    expect(abs(toCents('10.00'))).toBe(toCents('10.00'))
    expect(min(toCents('10.00'), toCents('3.00'))).toBe(toCents('3.00'))
    expect(max(toCents('10.00'), toCents('3.00'))).toBe(toCents('10.00'))
    expect(isZero(ZERO)).toBe(true)
    expect(isZero(toCents('0.01'))).toBe(false)
    expect(isNegative(toCents('-0.01'))).toBe(true)
    expect(isNegative(ZERO)).toBe(false)
  })
})

describe('multiplyRatio — redondeo HALF_UP', () => {
  it('medio día es exactamente la mitad', () => {
    expect(multiplyRatio(toCents('143.00'), 1n, 2n)).toBe(toCents('71.50'))
    expect(multiplyRatio(toCents('103.00'), 1n, 2n)).toBe(toCents('51.50'))
  })

  it('redondea hacia arriba en el punto medio exacto', () => {
    // 0.05 / 2 = 0.025 → 0.03
    expect(multiplyRatio(toCents('0.05'), 1n, 2n)).toBe(toCents('0.03'))
    // 0.15 / 2 = 0.075 → 0.08
    expect(multiplyRatio(toCents('0.15'), 1n, 2n)).toBe(toCents('0.08'))
  })

  it('redondea hacia abajo por debajo del punto medio', () => {
    // 100.00 / 3 = 33.3333 → 33.33
    expect(multiplyRatio(toCents('100.00'), 1n, 3n)).toBe(toCents('33.33'))
    // 200.00 / 3 = 66.6666 → 66.67
    expect(multiplyRatio(toCents('200.00'), 1n, 3n)).toBe(toCents('66.67'))
  })

  it('mantiene el signo con importes negativos', () => {
    expect(multiplyRatio(toCents('-143.00'), 1n, 2n)).toBe(toCents('-71.50'))
    expect(multiplyRatio(toCents('143.00'), -1n, 2n)).toBe(toCents('-71.50'))
    expect(multiplyRatio(toCents('-143.00'), -1n, 2n)).toBe(toCents('71.50'))
    expect(multiplyRatio(toCents('-143.00'), 1n, -2n)).toBe(toCents('71.50'))
  })

  it('rechaza denominador cero', () => {
    expect(() => multiplyRatio(toCents('10.00'), 1n, 0n)).toThrow(/Denominador cero/)
  })
})

describe('multiplyQuantity', () => {
  it('calcula días completos y medios', () => {
    expect(multiplyQuantity(toCents('200.00'), '5')).toBe(toCents('1000.00'))
    expect(multiplyQuantity(toCents('200.00'), '5.5')).toBe(toCents('1100.00'))
    expect(multiplyQuantity(toCents('143.00'), 0.5)).toBe(toCents('71.50'))
    expect(multiplyQuantity(toCents('200.00'), 0)).toBe(ZERO)
  })

  it('calcula pago por horas', () => {
    expect(multiplyQuantity(toCents('18.50'), '7.25')).toBe(toCents('134.13'))
  })

  it('rechaza cantidades con más de dos decimales', () => {
    expect(() => multiplyQuantity(toCents('100.00'), '1.005')).toThrow(/más de 2 decimales/)
    expect(() => multiplyQuantity(toCents('100.00'), 1.005)).toThrow(/más de 2 decimales/)
  })

  it('rechaza cantidades no reconocibles', () => {
    expect(() => multiplyQuantity(toCents('100.00'), 'Si')).toThrow(/no reconocida/)
    expect(() => quantityToHundredths(Number.NaN)).toThrow(/no finita/)
  })

  it('acepta cantidades negativas', () => {
    expect(quantityToHundredths('-1.5')).toBe(-150n)
  })
})

describe('percentage', () => {
  it('aplica la comisión del 2 % sobre el invoice', () => {
    expect(percentage(toCents('36928.23'), '2')).toBe(toCents('738.56'))
  })

  it('aplica el descuento de pronto pago con cuatro decimales', () => {
    expect(percentage(toCents('36928.23'), '1.0875')).toBe(toCents('401.59'))
  })

  it('acepta porcentaje como número y como negativo', () => {
    expect(percentage(toCents('1000.00'), 2.5)).toBe(toCents('25.00'))
    expect(percentage(toCents('1000.00'), '-2.5')).toBe(toCents('-25.00'))
  })

  it('rechaza porcentajes no reconocidos', () => {
    expect(() => percentage(toCents('100.00'), '2.00001')).toThrow(/no reconocido/)
    expect(() => percentage(toCents('100.00'), 'dos')).toThrow(/no reconocido/)
  })
})

describe('variance — BR-131', () => {
  it('reporta la diferencia de un centavo entre dos fuentes', () => {
    const diff = variance(toCents('4181.00'), toCents('4180.90'))
    expect(toDecimalString(diff)).toBe('0.10')
  })

  it('reporta cero cuando coinciden', () => {
    expect(variance(toCents('100.00'), toCents('100.00'))).toBe(ZERO)
  })

  it('reporta diferencia negativa cuando se pagó de más', () => {
    expect(toDecimalString(variance(toCents('100.00'), toCents('120.00')))).toBe('-20.00')
  })

  it('reproduce la diferencia real detectada en FORMATO COMIS week 29', () => {
    // I116 venta 5843.95 vs H116 consignado 5348.18 → J116 = 495.77
    expect(toDecimalString(variance(toCents('5843.95'), toCents('5348.18')))).toBe('495.77')
  })
})

describe('determinismo', () => {
  it('mil ejecuciones del mismo cálculo dan el mismo resultado', () => {
    const results = new Set<string>()
    for (let i = 0; i < 1000; i += 1) {
      const base = multiplyQuantity(toCents('143.00'), '5.5')
      const withBonus = add(base, toCents('120.00'))
      const net = subtract(withBonus, toCents('180.00'), toCents('250.00'))
      results.add(toDecimalString(net))
    }
    expect(results.size).toBe(1)
    expect([...results][0]).toBe('476.50')
  })
})
