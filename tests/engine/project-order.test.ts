import { describe, expect, it } from 'vitest'
import { agruparProyectos } from '@/lib/payroll/project-order'

/**
 * El selector de proyecto sale en cada fila y tiene 21 opciones. En una semana
 * de 40 personas son 40 listas de 21 pueblos: los que ya se usan van arriba.
 */

const todos = [
  { id: 'd', name: 'DUBLIN' },
  { id: 'a', name: 'Athens_GA' },
  { id: 't', name: 'Tuscaloosa AL' },
  { id: 'c', name: 'CULLMAN_AL' },
]

describe('los proyectos de la semana, arriba', () => {
  it('separa los que ya se usan de los demás', () => {
    const { enUso, resto } = agruparProyectos(todos, ['d', 't'])
    expect(enUso.map((p) => p.name)).toEqual(['DUBLIN', 'Tuscaloosa AL'])
    expect(resto.map((p) => p.name)).toEqual(['Athens_GA', 'CULLMAN_AL'])
  })

  it('cada grupo va alfabético, no en el orden en que llegaron', () => {
    // Si el orden cambiara con cada marca, la posición dejaría de ser memoria
    // muscular y habría que leer la lista entera cada vez.
    const { enUso } = agruparProyectos(todos, ['t', 'd', 'c'])
    expect(enUso.map((p) => p.name)).toEqual(['CULLMAN_AL', 'DUBLIN', 'Tuscaloosa AL'])
  })

  it('al empezar la semana no hay ninguno en uso: todos abajo', () => {
    const { enUso, resto } = agruparProyectos(todos, [])
    expect(enUso).toEqual([])
    expect(resto).toHaveLength(4)
  })

  it('los vacíos y nulos no cuentan como proyecto en uso', () => {
    // Un día a propósito sin proyecto no debe subir nada.
    const { enUso } = agruparProyectos(todos, [null, undefined, ''])
    expect(enUso).toEqual([])
  })

  it('un id repetido no duplica la fila', () => {
    const { enUso } = agruparProyectos(todos, ['d', 'd', 'd'])
    expect(enUso).toHaveLength(1)
  })

  it('un id que ya no existe en el catálogo se ignora sin romper', () => {
    const { enUso, resto } = agruparProyectos(todos, ['borrado'])
    expect(enUso).toEqual([])
    expect(resto).toHaveLength(4)
  })

  it('ningún proyecto se pierde por el camino', () => {
    const { enUso, resto } = agruparProyectos(todos, ['a'])
    expect(enUso.length + resto.length).toBe(todos.length)
  })
})
