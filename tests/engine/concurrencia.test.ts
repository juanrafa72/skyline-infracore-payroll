import { describe, expect, it } from 'vitest'
import {
  evaluarGuardado,
  fechaDeApertura,
  notaSuficiente,
} from '@/lib/payroll/concurrencia'

/**
 * Que dos personas capturando la misma semana no se pisen.
 *
 * El riesgo real: la rejilla manda los siete días cada vez que se guarda. Si
 * Leo abre el lunes, Rafael marca el martes, y Leo guarda a las 5 con su
 * pantalla vieja, el martes de Rafael desaparece sin que nadie se entere.
 *
 * Lo difícil no es detectarlo: es NO frenar el caso normal de una sola
 * persona marcando la semana día a día.
 */

const LUNES_9AM = new Date('2026-08-10T09:00:00Z')
const LUNES_5PM = new Date('2026-08-10T17:00:00Z')

describe('cuándo se pisaría el trabajo de alguien', () => {
  it('otra persona guardó mientras yo tenía la pantalla abierta: avisa', () => {
    const v = evaluarGuardado(
      { tocadaEn: LUNES_5PM, tocadaPor: 'leo', tocadaPorNombre: 'Leo' },
      { abiertaEn: LUNES_9AM, usuarioId: 'rafael' },
    )
    expect(v.tipo).toBe('PISARIA')
    if (v.tipo === 'PISARIA') {
      expect(v.quien).toBe('Leo')
      expect(v.mensaje).toContain('Leo')
    }
  })

  it('YO mismo guardé antes: eso es marcar la semana día a día, no conflicto', () => {
    // Es el caso normal —lunes, martes, miércoles— y frenarlo haría
    // inservible el guardado parcial.
    const v = evaluarGuardado(
      { tocadaEn: LUNES_5PM, tocadaPor: 'rafael', tocadaPorNombre: 'Rafael' },
      { abiertaEn: LUNES_9AM, usuarioId: 'rafael' },
    )
    expect(v.tipo).toBe('LIBRE')
  })

  it('la otra persona guardó ANTES de que yo abriera: ya lo estoy viendo', () => {
    const v = evaluarGuardado(
      { tocadaEn: LUNES_9AM, tocadaPor: 'leo', tocadaPorNombre: 'Leo' },
      { abiertaEn: LUNES_5PM, usuarioId: 'rafael' },
    )
    expect(v.tipo).toBe('LIBRE')
  })

  it('la semana está vacía: no hay nada que pisar', () => {
    const v = evaluarGuardado(
      { tocadaEn: null, tocadaPor: null, tocadaPorNombre: null },
      { abiertaEn: LUNES_9AM, usuarioId: 'rafael' },
    )
    expect(v.tipo).toBe('LIBRE')
  })

  it('sin saber cuándo se abrió, no se bloquea', () => {
    // Un formulario viejo o un campo que no llegó no puede convertirse en una
    // pared para quien solo quiere marcar días.
    const v = evaluarGuardado(
      { tocadaEn: LUNES_5PM, tocadaPor: 'leo', tocadaPorNombre: 'Leo' },
      { abiertaEn: null, usuarioId: 'rafael' },
    )
    expect(v.tipo).toBe('LIBRE')
  })

  it('sin nombre de la otra persona, igual avisa', () => {
    const v = evaluarGuardado(
      { tocadaEn: LUNES_5PM, tocadaPor: 'alguien', tocadaPorNombre: null },
      { abiertaEn: LUNES_9AM, usuarioId: 'rafael' },
    )
    expect(v.tipo).toBe('PISARIA')
    if (v.tipo === 'PISARIA') expect(v.quien).toBe('otra persona')
  })

  it('guardar en el mismo instante en que el otro guardó no bloquea', () => {
    // Empate: se trata como «ya lo vi». Bloquear por un milisegundo sería ruido.
    const v = evaluarGuardado(
      { tocadaEn: LUNES_9AM, tocadaPor: 'leo', tocadaPorNombre: 'Leo' },
      { abiertaEn: LUNES_9AM, usuarioId: 'rafael' },
    )
    expect(v.tipo).toBe('LIBRE')
  })
})

describe('la nota que queda registrada', () => {
  it('una explicación de verdad sirve', () => {
    expect(notaSuficiente('marcó mal el jueves, lo corrijo')).toBe(true)
  })

  it('vacía o de dos letras no', () => {
    // «ok» no le dice nada a quien lea la auditoría dentro de seis meses.
    for (const mala of ['', '   ', 'ok', 'ya', 'x']) {
      expect(notaSuficiente(mala)).toBe(false)
    }
  })

  it('nulo tampoco', () => {
    expect(notaSuficiente(null)).toBe(false)
    expect(notaSuficiente(undefined)).toBe(false)
  })
})

describe('la marca de cuándo se abrió la pantalla', () => {
  it('lee una fecha bien escrita', () => {
    expect(fechaDeApertura('2026-08-10T09:00:00Z')?.toISOString()).toBe(
      '2026-08-10T09:00:00.000Z',
    )
  })

  it('lo que no se entiende se trata como «no se sabe», no como error', () => {
    for (const basura of ['', 'abc', 'no-es-fecha', null, undefined]) {
      expect(fechaDeApertura(basura)).toBeNull()
    }
  })
})
