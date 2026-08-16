import { describe, expect, it } from 'vitest'
import { enumerar, progresoDeLaSemana } from '@/lib/payroll/progreso'

/**
 * Hasta dónde va la captura de una semana.
 *
 * La pregunta del negocio: se marca día a día pero solo se manda a aprobación
 * al final. Sin una señal, una semana a medias y una terminada se ven igual.
 *
 * Lo delicado es no volverse cantaleta: los días que todavía no llegan NO
 * faltan.
 */

const SEMANA = [
  '2026-08-09', // domingo
  '2026-08-10',
  '2026-08-11',
  '2026-08-12',
  '2026-08-13',
  '2026-08-14',
  '2026-08-15', // sábado
]

/** Marca a `personas` en cada uno de los días dados. */
function marcar(dias: readonly string[], personas: readonly string[]): Set<string> {
  const set = new Set<string>()
  for (const dia of dias) for (const p of personas) set.add(`${p}:${dia}`)
  return set
}

describe('lo que todavía no llega, no falta', () => {
  it('el miércoles no reclama por el jueves ni el viernes', () => {
    // Es la regla que hace útil el aviso: si cantaleteara por los días que no
    // han pasado, se aprendería a ignorarlo y no serviría el día que importa.
    const p = progresoDeLaSemana({
      dias: SEMANA,
      personas: 2,
      registradas: marcar(SEMANA.slice(0, 4), ['a', 'b']),
      hoy: '2026-08-12',
    })
    expect(p.alDia).toBe(true)
    expect(p.vacias).toBe(0)
    expect(p.diasCorridos).toHaveLength(4)
    expect(p.resumen).toContain('al día')
    expect(p.resumen).toContain('miércoles')
  })

  it('una semana abierta por adelantado no tiene nada pendiente', () => {
    const p = progresoDeLaSemana({
      dias: SEMANA,
      personas: 3,
      registradas: new Set(),
      hoy: '2026-08-05',
    })
    expect(p.casillas).toBe(0)
    expect(p.vacias).toBe(0)
    expect(p.resumen).toContain('todavía no empieza')
  })
})

describe('lo que sí falta', () => {
  it('dice qué días faltan, con su nombre', () => {
    // «Faltan 6 casillas» no le sirve a nadie; «falta el martes» sí.
    const p = progresoDeLaSemana({
      dias: SEMANA,
      personas: 2,
      registradas: marcar(['2026-08-09', '2026-08-10', '2026-08-12'], ['a', 'b']),
      hoy: '2026-08-12',
    })
    expect(p.diasEnBlanco).toEqual(['2026-08-11'])
    expect(p.resumen).toContain('martes')
    expect(p.alDia).toBe(false)
  })

  it('a una persona que se quedó sin marcar la cuenta como casilla vacía', () => {
    const p = progresoDeLaSemana({
      dias: SEMANA,
      personas: 3,
      registradas: marcar(['2026-08-09', '2026-08-10'], ['a', 'b']),
      hoy: '2026-08-10',
    })
    // 3 personas × 2 días = 6 casillas; hay 4 llenas.
    expect(p.casillas).toBe(6)
    expect(p.llenas).toBe(4)
    expect(p.vacias).toBe(2)
    // Ningún día quedó en blanco del todo, así que habla de casillas.
    expect(p.diasEnBlanco).toHaveLength(0)
    expect(p.resumen).toContain('2 casilla')
  })

  it('cuando la semana ya pasó, lo dice: esos días no se llenan solos', () => {
    const p = progresoDeLaSemana({
      dias: SEMANA,
      personas: 2,
      registradas: marcar(SEMANA.slice(0, 5), ['a', 'b']),
      hoy: '2026-08-20',
    })
    expect(p.terminada).toBe(true)
    expect(p.resumen).toContain('viernes y sábado')
    expect(p.resumen).toContain('ya pasó')
  })

  it('la semana completa se declara completa', () => {
    const p = progresoDeLaSemana({
      dias: SEMANA,
      personas: 2,
      registradas: marcar(SEMANA, ['a', 'b']),
      hoy: '2026-08-20',
    })
    expect(p.alDia).toBe(true)
    expect(p.resumen).toContain('completa')
  })
})

describe('casos que no deben reventar la cuenta', () => {
  it('sin gente en la semana, no hay nada que reclamar', () => {
    const p = progresoDeLaSemana({
      dias: SEMANA,
      personas: 0,
      registradas: new Set(),
      hoy: '2026-08-12',
    })
    expect(p.vacias).toBe(0)
    expect(p.resumen).toContain('nadie')
  })

  it('días de alguien que ya salió de la semana no inflan el conteo', () => {
    // Quitar a una persona no borra sus días. Sin tope, la semana se vería
    // «más que llena» y el aviso diría que todo está bien cuando no lo está.
    const p = progresoDeLaSemana({
      dias: SEMANA,
      personas: 1,
      registradas: marcar(['2026-08-09'], ['a', 'b', 'c']),
      hoy: '2026-08-09',
    })
    expect(p.casillas).toBe(1)
    expect(p.llenas).toBe(1)
    expect(p.vacias).toBe(0)
  })
})

describe('enumerar en español', () => {
  it('une con «y», no con comas al final', () => {
    expect(enumerar(['jueves'])).toBe('jueves')
    expect(enumerar(['jueves', 'viernes'])).toBe('jueves y viernes')
    expect(enumerar(['martes', 'jueves', 'viernes'])).toBe('martes, jueves y viernes')
    expect(enumerar([])).toBe('')
  })
})
