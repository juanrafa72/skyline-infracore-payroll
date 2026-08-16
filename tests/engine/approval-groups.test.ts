import { describe, expect, it } from 'vitest'
import { SIN_RECEPTORA, agruparPorReceptora } from '@/lib/disbursement/approval-groups'

/**
 * El ejemplo que dio el negocio: a Juan Rafael y a Juan José les paga FORZO y
 * a Federico, Quintero. Los dos de FORZO tienen que quedar juntos, con su
 * total al lado, antes de aprobar.
 */

const juanRafael = { id: '1', recipientId: 'forzo', recipientName: 'FORZO', net: '650.00' }
const federico = { id: '2', recipientId: 'quintero', recipientName: 'QUINTERO', net: '665.00' }
const juanJose = { id: '3', recipientId: 'forzo', recipientName: 'FORZO', net: '950.00' }

const todos = new Set(['1', '2', '3'])
const net = (row: { net: string }) => row.net

describe('el ejemplo de FORZO y Quintero', () => {
  it('agrupa a los dos de FORZO juntos', () => {
    const grupos = agruparPorReceptora([juanRafael, federico, juanJose], net, todos)

    expect(grupos).toHaveLength(2)
    const forzo = grupos.find((g) => g.name === 'FORZO')!
    expect(forzo.rows.map((r) => r.id)).toEqual(['1', '3'])
  })

  it('el total de FORZO es la suma de los suyos, no de todos', () => {
    const grupos = agruparPorReceptora([juanRafael, federico, juanJose], net, todos)
    expect(grupos.find((g) => g.name === 'FORZO')!.total).toBe('1600.00')
    expect(grupos.find((g) => g.name === 'QUINTERO')!.total).toBe('665.00')
  })

  it('los grupos salen en orden alfabético', () => {
    const grupos = agruparPorReceptora([federico, juanJose, juanRafael], net, todos)
    expect(grupos.map((g) => g.name)).toEqual(['FORZO', 'QUINTERO'])
  })
})

describe('los que todavía no tienen a quién pagarle', () => {
  const sinAsignar1 = { id: 'a', recipientId: null, recipientName: null, net: '100.00' }
  const sinAsignar2 = { id: 'b', recipientId: null, recipientName: null, net: '200.00' }

  it('van TODOS en un solo grupo, no uno por persona', () => {
    const grupos = agruparPorReceptora(
      [sinAsignar1, juanRafael, sinAsignar2],
      net,
      new Set(['a', 'b', '1']),
    )
    const sin = grupos.find((g) => g.key === SIN_RECEPTORA)!
    expect(sin.rows).toHaveLength(2)
    expect(sin.total).toBe('300.00')
  })

  it('van de primeros: son los que frenan la aprobación', () => {
    const grupos = agruparPorReceptora(
      [juanRafael, sinAsignar1, federico],
      net,
      new Set(['1', 'a', '2']),
    )
    expect(grupos[0]!.key).toBe(SIN_RECEPTORA)
  })
})

describe('lo marcado contra el total del grupo', () => {
  it('si se desmarca a alguien, el total marcado baja pero el del grupo no', () => {
    // Solo Juan Rafael marcado, Juan José no.
    const grupos = agruparPorReceptora([juanRafael, juanJose], net, new Set(['1']))
    const forzo = grupos[0]!
    expect(forzo.total).toBe('1600.00')
    expect(forzo.selectedTotal).toBe('650.00')
  })

  it('sin nada marcado el total del grupo sigue visible', () => {
    const grupos = agruparPorReceptora([juanRafael, juanJose], net, new Set())
    expect(grupos[0]!.total).toBe('1600.00')
    expect(grupos[0]!.selectedTotal).toBe('0.00')
  })
})

describe('la aritmética', () => {
  it('suma en centavos: los decimales no se pierden', () => {
    const filas = [
      { id: '1', recipientId: 'x', recipientName: 'X', net: '0.10' },
      { id: '2', recipientId: 'x', recipientName: 'X', net: '0.20' },
    ]
    // 0.1 + 0.2 en coma flotante da 0.30000000000000004.
    expect(agruparPorReceptora(filas, net, new Set(['1', '2']))[0]!.total).toBe('0.30')
  })

  it('sirve igual para cuadrillas y equipos, que suman otro campo', () => {
    const crews = [
      { id: 'c1', recipientId: 'forzo', recipientName: 'FORZO', total: '5000.00' },
      { id: 'e1', recipientId: 'forzo', recipientName: 'FORZO', total: '1800.00' },
    ]
    const grupos = agruparPorReceptora(crews, (row) => row.total, new Set(['c1', 'e1']))
    expect(grupos[0]!.total).toBe('6800.00')
  })

  it('una lista vacía no da grupos', () => {
    expect(agruparPorReceptora([], net, new Set())).toEqual([])
  })
})
