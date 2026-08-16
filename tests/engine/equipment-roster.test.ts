import { describe, expect, it } from 'vitest'
import { estaEnLaSemana, puedeSacarse, type EquipoDeLaSemana } from '@/lib/payroll/equipment/roster'

/**
 * Qué equipos van en la semana.
 *
 * Dos cosas que cuidar: que las semanas VIEJAS no aparezcan vacías —no tienen
 * a nadie escogido y el negocio creería que perdió lo que marcó— y que sacar
 * un equipo no borre trabajo en silencio.
 */

const equipo = (over: Partial<EquipoDeLaSemana> = {}): EquipoDeLaSemana => ({
  equipmentId: 'e1',
  escogido: false,
  diasMarcados: 0,
  tieneLiquidacion: false,
  ...over,
})

describe('cuándo un equipo está en la semana', () => {
  it('porque alguien lo escogió', () => {
    expect(estaEnLaSemana(equipo({ escogido: true }))).toBe(true)
  })

  it('o porque tiene días marcados, aunque nadie lo escogiera', () => {
    // Las semanas de antes de esta lista no tienen a nadie escogido. Sin esta
    // regla se abrirían vacías y parecería que se borraron los días.
    expect(estaEnLaSemana(equipo({ diasMarcados: 3 }))).toBe(true)
  })

  it('o porque ya tiene liquidación', () => {
    expect(estaEnLaSemana(equipo({ tieneLiquidacion: true }))).toBe(true)
  })

  it('sin nada de eso, no está', () => {
    expect(estaEnLaSemana(equipo())).toBe(false)
  })
})

describe('cuándo se puede sacar de la semana', () => {
  it('si no tiene nada encima, sí', () => {
    expect(puedeSacarse(equipo({ escogido: true })).puede).toBe(true)
  })

  it('con días marcados, no: sacarlo los borraría sin rastro', () => {
    const v = puedeSacarse(equipo({ escogido: true, diasMarcados: 4 }))
    expect(v.puede).toBe(false)
    if (!v.puede) {
      expect(v.porque).toContain('4 día')
      expect(v.porque).toContain('Quítale los días primero')
    }
  })

  it('con liquidación calculada, tampoco: eso es plata que alguien va a transferir', () => {
    const v = puedeSacarse(equipo({ escogido: true, tieneLiquidacion: true }))
    expect(v.puede).toBe(false)
    if (!v.puede) expect(v.porque).toContain('liquidación')
  })

  it('la liquidación manda sobre los días en el mensaje', () => {
    // Con las dos cosas, lo que hay que resolver primero es la liquidación.
    const v = puedeSacarse(equipo({ escogido: true, diasMarcados: 2, tieneLiquidacion: true }))
    expect(v.puede).toBe(false)
    if (!v.puede) expect(v.porque).toContain('liquidación')
  })
})
