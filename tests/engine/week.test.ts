import { describe, expect, it } from 'vitest'
import { dayName, shortDay, weekNumberOf, weekRangeOf, weekStartOf } from '@/lib/payroll/week'

describe('numeración de semanas — debe coincidir con WEEKNUM de Excel', () => {
  it('el 19 de julio de 2026 es la semana 30', () => {
    // Verificado contra los Excel: "DH UG · Corte = Semana 30", fechas 19–25 jul.
    expect(weekNumberOf('2026-07-19')).toBe(30)
    expect(weekNumberOf('2026-07-25')).toBe(30)
  })

  it('el 1 de enero pertenece a la semana 1', () => {
    expect(weekNumberOf('2026-01-01')).toBe(1)
  })

  it('el 1 de enero de 2026 cae jueves, como dicen los Excel', () => {
    expect(dayName('2026-01-01')).toBe('jueves')
  })

  it('cambia de semana al pasar de sábado a domingo', () => {
    expect(weekNumberOf('2026-07-18')).toBe(29) // sábado
    expect(weekNumberOf('2026-07-19')).toBe(30) // domingo
  })
})

describe('rango de la semana', () => {
  it('va de domingo a sábado', () => {
    const range = weekRangeOf('2026-07-22') // un miércoles
    expect(range.startDate).toBe('2026-07-19')
    expect(range.endDate).toBe('2026-07-25')
    expect(range.weekNumber).toBe(30)
    expect(range.label).toBe('Semana 30')
    expect(range.days).toHaveLength(7)
  })

  it('cualquier día de la semana da el mismo rango', () => {
    const fromSunday = weekRangeOf('2026-07-19')
    const fromSaturday = weekRangeOf('2026-07-25')
    expect(fromSaturday.startDate).toBe(fromSunday.startDate)
    expect(fromSaturday.endDate).toBe(fromSunday.endDate)
  })

  it('el domingo de la semana se calcula bien', () => {
    expect(weekStartOf('2026-07-25')).toBe('2026-07-19')
    expect(weekStartOf('2026-07-19')).toBe('2026-07-19')
  })

  it('los nombres de los días son correctos', () => {
    const range = weekRangeOf('2026-07-19')
    expect(range.days.map(dayName)).toEqual([
      'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado',
    ])
    expect(shortDay('2026-07-19')).toBe('dom 19')
  })
})
