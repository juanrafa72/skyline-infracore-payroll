/**
 * Aritmética de dinero — BR-130, BR-053.
 *
 * Todo el dinero del sistema pasa por aquí. Reglas:
 *  - Se representa en CENTAVOS ENTEROS (`bigint`). Nunca `number`.
 *  - El redondeo es ROUND_HALF_UP y se aplica UNA sola vez por concepto.
 *  - Convertir a texto produce siempre exactamente 2 decimales.
 *
 * El tipo `Cents` está marcado para que el compilador impida mezclarlo con
 * cantidades sueltas (días, horas, porcentajes).
 */

declare const centsBrand: unique symbol
export type Cents = bigint & { readonly [centsBrand]: true }

export const ZERO: Cents = 0n as Cents

/** Construye un valor en centavos a partir de un entero de centavos. */
export function cents(value: bigint | number): Cents {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new RangeError(`cents() exige un entero de centavos, recibió ${value}`)
    }
    return BigInt(value) as Cents
  }
  return value as Cents
}

const MONEY_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/

/**
 * Convierte un importe decimal en texto a centavos.
 * Acepta `'4180.90'`, `'4180.9'`, `'4180'`, `'-127.59'`, `'$4,180.90'`.
 * Más de 2 decimales es un error: el dato de origen tendría precisión que
 * el sistema no puede representar, y redondearlo en silencio sería una
 * pérdida invisible de dinero.
 */
export function toCents(amount: string | number | bigint): Cents {
  if (typeof amount === 'bigint') return amount as Cents
  const raw = typeof amount === 'number' ? formatNumberExact(amount) : amount
  const cleaned = raw.trim().replace(/[$\s]/g, '').replace(/,/g, '')
  const match = MONEY_PATTERN.exec(cleaned)
  if (!match) throw new RangeError(`Importe no reconocido: ${JSON.stringify(raw)}`)

  const [, sign, whole, fraction = ''] = match
  if (fraction.length > 2) {
    throw new RangeError(
      `Importe con más de 2 decimales: ${raw}. Redondear aquí ocultaría una diferencia.`,
    )
  }
  const padded = fraction.padEnd(2, '0')
  const value = BigInt(whole ?? '0') * 100n + BigInt(padded)
  return (sign === '-' ? -value : value) as Cents
}

function formatNumberExact(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Importe no finito: ${value}`)
  // Un `number` solo se acepta si representa exactamente centavos.
  const scaled = value * 100
  const rounded = Math.round(scaled)
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw new RangeError(
      `El número ${value} no representa centavos exactos. Usar texto para importes.`,
    )
  }
  return (rounded / 100).toFixed(2)
}

/** Representación decimal con 2 decimales exactos, apta para guardar y mostrar. */
export function toDecimalString(value: Cents): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const whole = abs / 100n
  const fraction = abs % 100n
  return `${negative ? '-' : ''}${whole}.${fraction.toString().padStart(2, '0')}`
}

export function add(...values: readonly Cents[]): Cents {
  let total = 0n
  for (const value of values) total += value
  return total as Cents
}

export function subtract(minuend: Cents, ...subtrahends: readonly Cents[]): Cents {
  let total = minuend as bigint
  for (const value of subtrahends) total -= value
  return total as Cents
}

export function sum(values: Iterable<Cents>): Cents {
  let total = 0n
  for (const value of values) total += value
  return total as Cents
}

export function negate(value: Cents): Cents {
  return -value as Cents
}

export function abs(value: Cents): Cents {
  return (value < 0n ? -value : value) as Cents
}

export function isNegative(value: Cents): boolean {
  return value < 0n
}

export function isZero(value: Cents): boolean {
  return value === 0n
}

/** Devuelve el menor de dos importes. Útil para topar recuperaciones al saldo. */
export function min(a: Cents, b: Cents): Cents {
  return (a < b ? a : b) as Cents
}

export function max(a: Cents, b: Cents): Cents {
  return (a > b ? a : b) as Cents
}

/**
 * Multiplica un importe por un factor racional expresado como numerador/denominador.
 * Redondeo ROUND_HALF_UP, una sola vez.
 *
 * Se usa numerador/denominador en vez de un `number` decimal para que el factor
 * 0.5 de un medio día sea exactamente 1/2 y no una aproximación binaria.
 */
export function multiplyRatio(value: Cents, numerator: bigint, denominator: bigint): Cents {
  if (denominator === 0n) throw new RangeError('Denominador cero')
  const negative = value < 0n !== numerator < 0n !== denominator < 0n
  const absValue = value < 0n ? -value : value
  const absNumerator = numerator < 0n ? -numerator : numerator
  const absDenominator = denominator < 0n ? -denominator : denominator

  const scaled = absValue * absNumerator
  const quotient = scaled / absDenominator
  const remainder = scaled % absDenominator
  // HALF_UP: se redondea hacia arriba cuando el resto llega a la mitad.
  const rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient
  return (negative ? -rounded : rounded) as Cents
}

/**
 * Multiplica por una cantidad con hasta 2 decimales (días, horas, unidades),
 * expresada como texto o número exacto. Redondeo HALF_UP una sola vez.
 */
export function multiplyQuantity(value: Cents, quantity: string | number): Cents {
  const scaled = quantityToHundredths(quantity)
  return multiplyRatio(value, scaled, 100n)
}

/**
 * PRECIO UNITARIO con hasta 4 decimales, en diezmilésimas de dólar.
 *
 * Un precio por pie NO es un importe: $0.3025 el pie es una tarifa legítima, y
 * `toCents` la rechaza —con razón— porque como importe tendría precisión que
 * el sistema no puede pagar. Pero la tarifa sí necesita esos decimales: sobre
 * 10.000 pies, redondearla a $0.30 se lleva $25 por delante.
 *
 * Por eso la base guarda `Decimal(18,4)` en `appliedPrice`, y aquí el precio
 * viaja en diezmilésimas hasta que se multiplica por la cantidad. El redondeo
 * a centavos ocurre UNA sola vez, sobre el resultado final.
 */
export function priceToTenThousandths(price: string | number): bigint {
  const raw = typeof price === 'number' ? formatPrice(price) : price.trim()
  const cleaned = raw.replace(/[$\s]/g, '').replace(/,/g, '')
  const match = MONEY_PATTERN.exec(cleaned)
  if (!match) throw new RangeError(`Precio no reconocido: ${JSON.stringify(price)}`)

  const [, sign, whole, fraction = ''] = match
  if (fraction.length > 4) {
    throw new RangeError(
      `Precio con más de 4 decimales: ${price}. La base solo guarda 4 y redondear aquí ` +
        'escondería una diferencia.',
    )
  }
  const value = BigInt(whole ?? '0') * 10_000n + BigInt(fraction.padEnd(4, '0'))
  return sign === '-' ? -value : value
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Precio no finito: ${value}`)
  const scaled = value * 10_000
  const rounded = Math.round(scaled)
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw new RangeError(`El precio ${value} tiene más de 4 decimales.`)
  }
  return (rounded / 10_000).toFixed(4)
}

/**
 * Cantidad × precio unitario = importe en centavos.
 *
 * Ejemplo del negocio: 10.000 pies × $0.30 = $3.000,00. La multiplicación se
 * hace entera (cantidad en centésimas × precio en diezmilésimas) y se redondea
 * a centavos UNA vez al final — nunca en cadena.
 */
export function unitPriceTotal(quantity: string | number, price: string | number): Cents {
  const q = quantityToHundredths(quantity) // centésimas de unidad
  const p = priceToTenThousandths(price) // diezmilésimas de dólar
  // q/100 unidades × p/10000 dólares = q·p/1.000.000 dólares = q·p/10.000 centavos
  const negative = q < 0n !== p < 0n
  const scaled = (q < 0n ? -q : q) * (p < 0n ? -p : p)
  const quotient = scaled / 10_000n
  const remainder = scaled % 10_000n
  const rounded = remainder * 2n >= 10_000n ? quotient + 1n : quotient
  return (negative ? -rounded : rounded) as Cents
}

/** Un precio unitario de vuelta a texto, con sus 4 decimales. */
export function priceToDecimalString(tenThousandths: bigint): string {
  const negative = tenThousandths < 0n
  const abs = negative ? -tenThousandths : tenThousandths
  const whole = abs / 10_000n
  const fraction = (abs % 10_000n).toString().padStart(4, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

/** Convierte una cantidad decimal (máx. 2 decimales) a centésimas enteras. */
export function quantityToHundredths(quantity: string | number): bigint {
  const raw = typeof quantity === 'number' ? formatQuantity(quantity) : quantity.trim()
  const match = MONEY_PATTERN.exec(raw)
  if (!match) throw new RangeError(`Cantidad no reconocida: ${JSON.stringify(quantity)}`)
  const [, sign, whole, fraction = ''] = match
  if (fraction.length > 2) {
    throw new RangeError(`Cantidad con más de 2 decimales: ${quantity}`)
  }
  const value = BigInt(whole ?? '0') * 100n + BigInt(fraction.padEnd(2, '0'))
  return sign === '-' ? -value : value
}

function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Cantidad no finita: ${value}`)
  const scaled = value * 100
  const rounded = Math.round(scaled)
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw new RangeError(`La cantidad ${value} tiene más de 2 decimales.`)
  }
  return (rounded / 100).toFixed(2)
}

/**
 * Aplica un porcentaje expresado con hasta 4 decimales (`'2'`, `'2.5'`, `'1.0900'`).
 * Redondeo HALF_UP una sola vez.
 */
export function percentage(value: Cents, percent: string | number): Cents {
  const raw = typeof percent === 'number' ? percent.toString() : percent.trim()
  const match = /^(-)?(\d+)(?:\.(\d{1,4}))?$/.exec(raw)
  if (!match) throw new RangeError(`Porcentaje no reconocido: ${JSON.stringify(percent)}`)
  const [, sign, whole, fraction = ''] = match
  const scaled = BigInt(whole ?? '0') * 10000n + BigInt(fraction.padEnd(4, '0'))
  const numerator = sign === '-' ? -scaled : scaled
  // porcentaje: value * n / (10000 * 100)
  return multiplyRatio(value, numerator, 1_000_000n)
}

/**
 * Diferencia entre lo esperado y lo real — BR-131.
 * Se devuelve siempre, aunque sea de un centavo. Nunca se absorbe.
 */
export function variance(expected: Cents, actual: Cents): Cents {
  return subtract(expected, actual)
}
