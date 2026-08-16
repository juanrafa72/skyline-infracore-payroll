import { describe, expect, it } from 'vitest'
import { toDecimalString } from '@/lib/payroll/engine/money'
import {
  agruparRetenciones,
  antiguedadEnPalabras,
  cuadrarCheque,
  diasEntre,
  totalRetenido,
  vuelveAlgunDia,
} from '@/lib/cobros'

/**
 * Los cheques que nos pagan y lo que nos descuentan.
 *
 * Lo que estas pruebas cuidan: que una diferencia no se pueda «cuadrar» en
 * silencio, y que la plata retenida se pueda reclamar — que exige saber a qué
 * CLIENTE y a qué PROYECTO pertenece, no solo cuánta es.
 */

describe('cuadrar el cheque', () => {
  it('lo que entró más los descuentos da el valor del cheque', () => {
    const r = cuadrarCheque({
      esperado: '50000.00',
      recibido: '38000.00',
      descuentos: [
        { clase: 'RETENCION', monto: '10000.00', motivo: 'Retención hasta terminar Dublin' },
        { clase: 'MATERIAL', monto: '2000.00', motivo: 'Fibra que puso el cliente' },
      ],
    })
    expect(r.estado).toBe('CUADRA')
  })

  it('sin descuentos, tiene que entrar completo', () => {
    expect(cuadrarCheque({ esperado: '1000.00', recibido: '1000.00', descuentos: [] }).estado).toBe(
      'CUADRA',
    )
  })

  it('si falta plata sin explicar, lo dice y dice cuánta', () => {
    // El caso que importa: entraron doce mil menos y nadie escribió por qué.
    const r = cuadrarCheque({
      esperado: '50000.00',
      recibido: '38000.00',
      descuentos: [],
    })
    expect(r.estado).toBe('FALTA_EXPLICAR')
    if (r.estado === 'FALTA_EXPLICAR') {
      expect(toDecimalString(r.monto)).toBe('12000.00')
      expect(r.mensaje).toContain('se pierde de vista')
    }
  })

  it('explicando solo una parte, sigue faltando el resto', () => {
    const r = cuadrarCheque({
      esperado: '50000.00',
      recibido: '38000.00',
      descuentos: [{ clase: 'RETENCION', monto: '10000.00', motivo: 'Dublin' }],
    })
    expect(r.estado).toBe('FALTA_EXPLICAR')
    if (r.estado === 'FALTA_EXPLICAR') expect(toDecimalString(r.monto)).toBe('2000.00')
  })

  it('si entró de más, también avisa: es un error de captura', () => {
    const r = cuadrarCheque({ esperado: '1000.00', recibido: '1200.00', descuentos: [] })
    expect(r.estado).toBe('SOBRA')
    if (r.estado === 'SOBRA') expect(toDecimalString(r.monto)).toBe('200.00')
  })

  it('los centavos no se pierden sumando muchos descuentos', () => {
    const descuentos = Array.from({ length: 33 }, () => ({
      clase: 'OTRO' as const,
      monto: '0.01',
      motivo: 'x',
    }))
    const r = cuadrarCheque({ esperado: '100.33', recibido: '100.00', descuentos })
    expect(r.estado).toBe('CUADRA')
  })
})

describe('cuál plata vuelve', () => {
  it('la retención vuelve; lo demás no', () => {
    expect(vuelveAlgunDia('RETENCION')).toBe(true)
    expect(vuelveAlgunDia('MATERIAL')).toBe(false)
    expect(vuelveAlgunDia('DANO')).toBe(false)
    expect(vuelveAlgunDia('ANTICIPO')).toBe(false)
  })
})

describe('cuánto llevan reteniéndonos', () => {
  it('cuenta los días', () => {
    expect(diasEntre('2026-05-01', '2026-08-16')).toBe(107)
    expect(diasEntre('2026-08-16', '2026-08-16')).toBe(0)
  })

  it('una fecha al revés no da negativo', () => {
    expect(diasEntre('2026-08-16', '2026-05-01')).toBe(0)
  })

  it('lo dice como lo dice el negocio', () => {
    // «97 días» no sirve para decidir si toca reclamar; «3 meses y 7 días» sí.
    expect(antiguedadEnPalabras(0)).toBe('hoy')
    expect(antiguedadEnPalabras(1)).toBe('1 día')
    expect(antiguedadEnPalabras(15)).toBe('15 días')
    expect(antiguedadEnPalabras(30)).toBe('1 mes')
    expect(antiguedadEnPalabras(97)).toBe('3 meses y 7 días')
  })
})

describe('las retenciones, por cliente Y por proyecto', () => {
  const HOY = '2026-08-16'

  it('el caso que puso el negocio: mismo cliente, dos obras', () => {
    // A Bigham en Dublin nos retienen; en Chiefland ya soltaron lo suyo.
    // Sumarlos daría un número que no se puede reclamar en ninguna parte.
    const grupos = agruparRetenciones(
      [
        {
          customerId: 'big',
          customerName: 'Bigham',
          projectId: 'dub',
          projectName: 'Dublin',
          monto: '10000.00',
          devuelta: '0.00',
          desde: '2026-05-01',
        },
        {
          customerId: 'big',
          customerName: 'Bigham',
          projectId: 'chi',
          projectName: 'Chiefland',
          monto: '4000.00',
          devuelta: '4000.00',
          desde: '2026-06-01',
        },
      ],
      HOY,
    )

    expect(grupos).toHaveLength(1)
    expect(grupos[0]!.projectName).toBe('Dublin')
    expect(toDecimalString(grupos[0]!.vivo)).toBe('10000.00')
    expect(grupos[0]!.antiguedad).toBe('3 meses y 17 días')
  })

  it('varias retenciones de la misma obra se suman, y manda la más vieja', () => {
    const grupos = agruparRetenciones(
      [
        {
          customerId: 'big', customerName: 'Bigham', projectId: 'dub', projectName: 'Dublin',
          monto: '10000.00', devuelta: '0.00', desde: '2026-05-01',
        },
        {
          customerId: 'big', customerName: 'Bigham', projectId: 'dub', projectName: 'Dublin',
          monto: '5000.00', devuelta: '0.00', desde: '2026-07-01',
        },
      ],
      HOY,
    )
    expect(grupos).toHaveLength(1)
    expect(toDecimalString(grupos[0]!.vivo)).toBe('15000.00')
    expect(grupos[0]!.cuantos).toBe(2)
    // La antigüedad es la de la más vieja: es la que hay que reclamar.
    expect(grupos[0]!.dias).toBe(107)
  })

  it('una devuelta a medias deja vivo solo el resto', () => {
    const grupos = agruparRetenciones(
      [
        {
          customerId: 'big', customerName: 'Bigham', projectId: 'dub', projectName: 'Dublin',
          monto: '10000.00', devuelta: '6000.00', desde: '2026-05-01',
        },
      ],
      HOY,
    )
    expect(toDecimalString(grupos[0]!.vivo)).toBe('4000.00')
  })

  it('lo ya devuelto desaparece de la lista', () => {
    const grupos = agruparRetenciones(
      [
        {
          customerId: 'big', customerName: 'Bigham', projectId: 'dub', projectName: 'Dublin',
          monto: '10000.00', devuelta: '10000.00', desde: '2026-05-01',
        },
      ],
      HOY,
    )
    expect(grupos).toHaveLength(0)
  })

  it('primero lo que más lleva quieto', () => {
    const grupos = agruparRetenciones(
      [
        {
          customerId: 'a', customerName: 'A', projectId: 'p1', projectName: 'P1',
          monto: '100.00', devuelta: '0.00', desde: '2026-08-01',
        },
        {
          customerId: 'b', customerName: 'B', projectId: 'p2', projectName: 'P2',
          monto: '100.00', devuelta: '0.00', desde: '2026-01-01',
        },
      ],
      HOY,
    )
    expect(grupos[0]!.customerName).toBe('B')
    expect(toDecimalString(totalRetenido(grupos))).toBe('200.00')
  })

  it('una retención sin proyecto no se mezcla con las que sí lo tienen', () => {
    // Sin proyecto no se sabe cuándo la devuelven; juntarla con Dublin haría
    // creer que ese saldo se libera al terminar Dublin.
    const grupos = agruparRetenciones(
      [
        {
          customerId: 'big', customerName: 'Bigham', projectId: 'dub', projectName: 'Dublin',
          monto: '100.00', devuelta: '0.00', desde: '2026-05-01',
        },
        {
          customerId: 'big', customerName: 'Bigham', projectId: null, projectName: null,
          monto: '50.00', devuelta: '0.00', desde: '2026-05-01',
        },
      ],
      HOY,
    )
    expect(grupos).toHaveLength(2)
  })
})
