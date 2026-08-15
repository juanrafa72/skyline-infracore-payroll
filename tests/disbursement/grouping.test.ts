/**
 * Agrupación y cuadre de las órdenes de desembolso.
 *
 * Estas pruebas cubren la regla que hace que el dinero no se pierda: la suma de
 * todas las órdenes tiene que dar exactamente el total aprobado.
 */
import { describe, expect, it } from 'vitest'
import { checkBalance, groupByRecipient } from '@/lib/disbursement/grouping'
import { coreRecipientName, findDuplicate, normalizeRecipientName } from '@/lib/disbursement/naming'
import { toCents, toDecimalString } from '@/lib/payroll/engine/money'

function payroll(
  id: string,
  name: string,
  net: string,
  recipientId: string | null,
  recipientName: string | null = recipientId,
  weekId = 'week-1',
) {
  return {
    kind: 'WORKER' as const,
    payableId: id,
    refId: `w-${id}`,
    name,
    crewLabel: null,
    detail: '5 días',
    payrollWeekId: weekId,
    amount: net,
    recipientId,
    recipientName,
  }
}

describe('agrupar por empresa receptora', () => {
  it('una sola receptora deja una sola orden', () => {
    const result = groupByRecipient([
      payroll('1', 'Ana', '500.00', 'r1', 'Receptora A'),
      payroll('2', 'Beto', '300.00', 'r1', 'Receptora A'),
    ])

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]!.items).toHaveLength(2)
    expect(toDecimalString(result.groups[0]!.total)).toBe('800.00')
    expect(toDecimalString(result.grandTotal)).toBe('800.00')
  })

  it('varias receptoras dejan una orden cada una', () => {
    const result = groupByRecipient([
      payroll('1', 'Ana', '500.00', 'r1', 'Receptora A'),
      payroll('2', 'Beto', '300.00', 'r2', 'Receptora B'),
      payroll('3', 'Carla', '250.50', 'r1', 'Receptora A'),
    ])

    expect(result.groups).toHaveLength(2)
    const byName = new Map(result.groups.map((group) => [group.recipientName, group]))
    expect(toDecimalString(byName.get('Receptora A')!.total)).toBe('750.50')
    expect(toDecimalString(byName.get('Receptora B')!.total)).toBe('300.00')
  })

  it('la misma receptora en dos semanas son dos órdenes', () => {
    const result = groupByRecipient([
      payroll('1', 'Ana', '100.00', 'r1', 'Receptora A', 'week-1'),
      payroll('2', 'Ana', '100.00', 'r1', 'Receptora A', 'week-2'),
    ])

    expect(result.groups).toHaveLength(2)
  })

  it('quien no tiene receptora queda aparte, no se reparte a nadie', () => {
    const result = groupByRecipient([
      payroll('1', 'Ana', '500.00', 'r1', 'Receptora A'),
      payroll('2', 'Beto', '300.00', null),
    ])

    expect(result.groups).toHaveLength(1)
    expect(result.unassigned).toEqual([{ payableId: '2', kind: 'WORKER', name: 'Beto' }])
    // El total agrupado NO incluye a quien no tiene destino.
    expect(toDecimalString(result.grandTotal)).toBe('500.00')
  })

  it('los centavos no se pierden al sumar muchos', () => {
    const rows = Array.from({ length: 97 }, (_, index) =>
      payroll(String(index), `P${index}`, '33.33', 'r1', 'Receptora A'),
    )
    const result = groupByRecipient(rows)
    expect(toDecimalString(result.grandTotal)).toBe('3233.01')
  })

  it('cada renglón llega al resumen con el contra qué se paga', () => {
    // Quien aprueba tiene que ver a cuántos días equivale el pago sin salir de
    // la pantalla: el dato viaja pegado al renglón, no se recalcula al mostrar.
    const result = groupByRecipient([payroll('1', 'Ana', '500.00', 'r1', 'Receptora A')])
    expect(result.groups[0]!.items[0]!.detail).toBe('5 días')
  })

  it('las personas salen en orden alfabético', () => {
    const result = groupByRecipient([
      payroll('1', 'Zoe', '10.00', 'r1'),
      payroll('2', 'Ana', '10.00', 'r1'),
    ])
    expect(result.groups[0]!.items.map((item) => item.name)).toEqual(['Ana', 'Zoe'])
  })
})

describe('cuadre contra el total aprobado', () => {
  it('cuadra cuando todos tienen receptora', () => {
    const rows = [
      payroll('1', 'Ana', '500.00', 'r1'),
      payroll('2', 'Beto', '300.00', 'r2'),
    ]
    const { groups } = groupByRecipient(rows)
    const balance = checkBalance(toCents('800.00'), groups)

    expect(balance.balanced).toBe(true)
    expect(balance.message).toBeNull()
  })

  it('no cuadra si alguien quedó sin repartir, y lo dice con números', () => {
    const rows = [payroll('1', 'Ana', '500.00', 'r1'), payroll('2', 'Beto', '300.00', null)]
    const { groups } = groupByRecipient(rows)
    const balance = checkBalance(toCents('800.00'), groups)

    expect(balance.balanced).toBe(false)
    expect(balance.message).toContain('500.00')
    expect(balance.message).toContain('800.00')
    expect(balance.message).toContain('faltan $300.00')
  })

  it('un centavo de diferencia también bloquea', () => {
    const { groups } = groupByRecipient([payroll('1', 'Ana', '500.00', 'r1')])
    const balance = checkBalance(toCents('500.01'), groups)

    expect(balance.balanced).toBe(false)
    expect(balance.message).toContain('faltan $0.01')
  })

  it('avisa también cuando sobra', () => {
    const { groups } = groupByRecipient([payroll('1', 'Ana', '500.00', 'r1')])
    const balance = checkBalance(toCents('400.00'), groups)

    expect(balance.balanced).toBe(false)
    expect(balance.message).toContain('sobran $100.00')
  })
})

describe('nombres de empresas receptoras', () => {
  it('normaliza tildes, mayúsculas y espacios de más', () => {
    expect(normalizeRecipientName('  Fibra  Óptica S.A.S  ')).toBe('fibra optica s a s')
    expect(normalizeRecipientName('CONSTRUCCIÓN')).toBe(normalizeRecipientName('construccion'))
  })

  it('ignora el sufijo societario al comparar', () => {
    expect(coreRecipientName('Acme LLC')).toBe(coreRecipientName('ACME Inc'))
  })

  it('un nombre idéntico bloquea', () => {
    const match = findDuplicate('Acme LLC', [
      { id: 'a', name: 'ACME  llc', normalizedName: 'acme llc', active: true },
    ])
    expect(match?.kind).toBe('exact')
  })

  it('una inactiva con el mismo nombre dice que se active en vez de duplicar', () => {
    const match = findDuplicate('Acme LLC', [
      { id: 'a', name: 'Acme LLC', normalizedName: 'acme llc', active: false },
    ])
    expect(match?.kind).toBe('exact')
    expect(match?.why).toContain('inactiva')
  })

  it('un nombre parecido solo avisa: decidir no le toca al sistema', () => {
    const match = findDuplicate('Acme Inc', [
      { id: 'a', name: 'Acme LLC', normalizedName: 'acme llc', active: true },
    ])
    expect(match?.kind).toBe('similar')
    expect(match?.why).toContain('Acme LLC')
  })

  it('dos empresas distintas no se confunden', () => {
    const match = findDuplicate('Beta Fiber', [
      { id: 'a', name: 'Acme LLC', normalizedName: 'acme llc', active: true },
    ])
    expect(match).toBeNull()
  })
})
