/**
 * El proyecto de cada día de la rejilla.
 *
 * De aquí sale a quién se le factura ese día. Que el día mande sobre la semana
 * no es una preferencia de pantalla: es la diferencia entre cobrarle a Dublin
 * lo que se trabajó en Homer.
 */
import { describe, expect, it } from 'vitest'
import { projectForDay, readProjectSelection } from '@/lib/payroll/grid'

const LUNES = '2026-08-10'
const MIERCOLES = '2026-08-12'

describe('lo que la rejilla dice del proyecto', () => {
  it('un proyecto para toda la semana aplica a todos los días', () => {
    const selection = readProjectSelection([['proyecto:w1', 'dublin']])

    expect(projectForDay(selection, 'w1', LUNES)).toEqual({ chose: true, projectId: 'dublin' })
    expect(projectForDay(selection, 'w1', MIERCOLES)).toEqual({ chose: true, projectId: 'dublin' })
  })

  it('el proyecto del día le gana al de la semana', () => {
    const selection = readProjectSelection([
      ['proyecto:w1', 'dublin'],
      [`proyectodia:w1:${MIERCOLES}`, 'homer'],
    ])

    expect(projectForDay(selection, 'w1', LUNES).projectId).toBe('dublin')
    expect(projectForDay(selection, 'w1', MIERCOLES).projectId).toBe('homer')
  })

  it('la fila por día no le cambia el proyecto a nadie más', () => {
    const selection = readProjectSelection([
      ['proyecto:w1', 'dublin'],
      [`proyectodia:w1:${MIERCOLES}`, 'homer'],
      ['proyecto:w2', 'dublin'],
    ])

    expect(projectForDay(selection, 'w2', MIERCOLES).projectId).toBe('dublin')
  })

  it('un día vacío es «sin proyecto» dicho a propósito, no «no dijo nada»', () => {
    const selection = readProjectSelection([
      ['proyecto:w1', 'dublin'],
      [`proyectodia:w1:${MIERCOLES}`, ''],
    ])

    expect(projectForDay(selection, 'w1', MIERCOLES)).toEqual({ chose: true, projectId: null })
  })

  it('sin campos, nadie eligió: el día guardado no se toca', () => {
    const selection = readProjectSelection([['day:w1:2026-08-10', 'FULL_DAY']])

    expect(projectForDay(selection, 'w1', LUNES)).toEqual({ chose: false, projectId: null })
  })

  it('la semana en blanco sí borra el proyecto: es una decisión', () => {
    const selection = readProjectSelection([['proyecto:w1', '']])

    expect(projectForDay(selection, 'w1', LUNES)).toEqual({ chose: true, projectId: null })
  })

  it('«proyectodia» no se cuela como si fuera el de la semana', () => {
    // Los dos nombres empiezan igual: si el prefijo se revisa al revés, el id
    // del trabajador quedaría siendo «dia:w1:2026-08-12».
    const selection = readProjectSelection([[`proyectodia:w1:${MIERCOLES}`, 'homer']])

    expect(selection.byWorker.size).toBe(0)
    expect(projectForDay(selection, 'w1', MIERCOLES).projectId).toBe('homer')
    // Otro día de esa misma persona sigue sin respuesta.
    expect(projectForDay(selection, 'w1', LUNES).chose).toBe(false)
  })

  it('los espacios de más no crean proyectos fantasma', () => {
    const selection = readProjectSelection([['proyecto:w1', '   ']])
    expect(projectForDay(selection, 'w1', LUNES)).toEqual({ chose: true, projectId: null })
  })
})
