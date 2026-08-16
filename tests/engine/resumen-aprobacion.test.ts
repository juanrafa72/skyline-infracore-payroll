import { describe, expect, it } from 'vitest'
import { toDecimalString } from '@/lib/payroll/engine/money'
import { formatSummaryNumber, resumirParaAprobacion } from '@/lib/payroll/resumen-aprobacion'

/**
 * El resumen que Leo revisa antes de mandarle la semana a Rafael.
 *
 * Lo que estas pruebas cuidan es la suma: es la cifra contra la que alguien va
 * a decir «sí, mándalo», y si pierde centavos por el camino no cuadra después
 * contra el banco.
 */

describe('lo que suma el resumen', () => {
  it('junta los tres bloques y da el gran total', () => {
    const r = resumirParaAprobacion({
      personal: [
        { nombre: 'ABDEL', neto: '650.00' },
        { nombre: 'AGUSTIN', neto: '665.00' },
        { nombre: 'ALEJANDRINO', neto: '950.00' },
      ],
      equipos: [{ nombre: 'PLOW RENTADO', neto: '1350.00' }],
      cuadrillas: [
        { nombre: 'CUADRILLA HUGO', neto: '5000.00' },
        { nombre: 'CUADRILLA JESUS', neto: '3200.00' },
      ],
    })

    expect(r.personal.cuantos).toBe(3)
    expect(toDecimalString(r.personal.total)).toBe('2265.00')
    expect(toDecimalString(r.equipos.total)).toBe('1350.00')
    expect(toDecimalString(r.cuadrillas.total)).toBe('8200.00')
    expect(toDecimalString(r.total)).toBe('11815.00')
    expect(r.cuantos).toBe(6)
  })

  it('no pierde centavos sumando muchos renglones', () => {
    // 149 personas a $0.01: sumando con decimales y redondeando al final es
    // donde aparecen las diferencias que después no cuadran contra el banco.
    const personal = Array.from({ length: 149 }, (_, i) => ({
      nombre: `P${i}`,
      neto: '0.01',
    }))
    const r = resumirParaAprobacion({ personal, equipos: [], cuadrillas: [] })
    expect(toDecimalString(r.total)).toBe('1.49')
  })

  it('un bloque vacío suma cero y lo dice', () => {
    const r = resumirParaAprobacion({
      personal: [{ nombre: 'ABDEL', neto: '100.00' }],
      equipos: [],
      cuadrillas: [],
    })
    expect(r.equipos.cuantos).toBe(0)
    expect(toDecimalString(r.equipos.total)).toBe('0.00')
    expect(toDecimalString(r.total)).toBe('100.00')
  })

  it('sin nada que mandar, el resumen lo declara en cero', () => {
    const r = resumirParaAprobacion({ personal: [], equipos: [], cuadrillas: [] })
    expect(r.cuantos).toBe(0)
    expect(toDecimalString(r.total)).toBe('0.00')
  })

  it('conserva los renglones para poder mostrarlos', () => {
    // El total sin el detalle no sirve para dar un visto bueno: hay que poder
    // ver a quién se le está pagando.
    const r = resumirParaAprobacion({
      personal: [{ nombre: 'ABDEL', neto: '650.00' }],
      equipos: [],
      cuadrillas: [],
    })
    expect(r.personal.renglones[0]!.nombre).toBe('ABDEL')
  })
})

describe('el consecutivo', () => {
  it('lleva compañía y año adentro', () => {
    expect(formatSummaryNumber('SKYLINE', 2026, 7)).toBe('RA-SKYLINE-2026-0007')
    expect(formatSummaryNumber('INFRACORE', 2026, 1234)).toBe('RA-INFRACORE-2026-1234')
  })

  it('no se confunde con el de las órdenes ni con el de los reportes', () => {
    // OD- es dinero que sale; RP- es un correo enviado; RA- es un visto bueno.
    expect(formatSummaryNumber('SKYLINE', 2026, 1).startsWith('RA-')).toBe(true)
  })
})
