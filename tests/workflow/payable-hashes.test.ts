import { describe, expect, it } from 'vitest'
import { sumProductionAmounts, equipmentTotal } from '@/lib/payroll/engine/payables'
import { toCents, toDecimalString } from '@/lib/payroll/engine/money'
import {
  crewCalculationHash,
  equipmentCalculationHash,
  type CrewMaterialFields,
  type EquipmentMaterialFields,
} from '@/lib/payroll/workflow'

/**
 * Huellas y totales de los pagables de cuadrilla y equipo.
 *
 * La huella decide cuándo se cae una aprobación: tiene que ser estable ante
 * reordenamientos (o cualquier consulta en otro orden parecería un cambio) y
 * sensible a TODO lo que mueva dinero.
 */

const CREW: CrewMaterialFields = {
  crewId: 'crew-1',
  contractorId: 'con-1',
  production: [
    { date: '2026-07-20', unitCode: 'FIBER', quantity: '1000.00', appliedPrice: '0.5', amount: '500.00' },
    { date: '2026-07-21', unitCode: 'STRAND', quantity: '2000.00', appliedPrice: '0.15', amount: '300.00' },
  ],
  total: '800.00',
}

describe('crewCalculationHash', () => {
  it('el mismo contenido en otro orden da la misma huella', () => {
    const reordered = { ...CREW, production: [CREW.production[1]!, CREW.production[0]!] }
    expect(crewCalculationHash(reordered)).toBe(crewCalculationHash(CREW))
  })

  it('cambiar un monto cambia la huella', () => {
    const changed = {
      ...CREW,
      production: [CREW.production[0]!, { ...CREW.production[1]!, amount: '301.00' }],
    }
    expect(crewCalculationHash(changed)).not.toBe(crewCalculationHash(CREW))
  })

  it('cambiar el contratista cambia la huella — a él se le paga', () => {
    expect(crewCalculationHash({ ...CREW, contractorId: 'con-2' })).not.toBe(
      crewCalculationHash(CREW),
    )
  })

  it('sin contratista no es lo mismo que con contratista', () => {
    expect(crewCalculationHash({ ...CREW, contractorId: null })).not.toBe(
      crewCalculationHash(CREW),
    )
  })
})

const EQUIPMENT: EquipmentMaterialFields = {
  equipmentId: 'eq-1',
  vendorId: 'ven-1',
  days: ['2026-07-20', '2026-07-21', '2026-07-22'],
  appliedDailyCost: '450.00',
  total: '1350.00',
}

describe('equipmentCalculationHash', () => {
  it('los días en otro orden dan la misma huella', () => {
    const reordered = { ...EQUIPMENT, days: ['2026-07-22', '2026-07-20', '2026-07-21'] }
    expect(equipmentCalculationHash(reordered)).toBe(equipmentCalculationHash(EQUIPMENT))
  })

  it('un día más cambia la huella', () => {
    const extra = { ...EQUIPMENT, days: [...EQUIPMENT.days, '2026-07-23'] }
    expect(equipmentCalculationHash(extra)).not.toBe(equipmentCalculationHash(EQUIPMENT))
  })

  it('cambiar el costo diario congelado cambia la huella', () => {
    expect(
      equipmentCalculationHash({ ...EQUIPMENT, appliedDailyCost: '451.00' }),
    ).not.toBe(equipmentCalculationHash(EQUIPMENT))
  })

  it('cambiar el proveedor cambia la huella', () => {
    expect(equipmentCalculationHash({ ...EQUIPMENT, vendorId: null })).not.toBe(
      equipmentCalculationHash(EQUIPMENT),
    )
  })
})

describe('totales en centavos', () => {
  it('suma producción exacta, sin coma flotante', () => {
    // 0.10 + 0.20 en float es 0.30000000000000004; en centavos es 30 exacto.
    expect(toDecimalString(sumProductionAmounts(['0.10', '0.20']))).toBe('0.30')
    expect(toDecimalString(sumProductionAmounts(['4250.00', '4250.00']))).toBe('8500.00')
  })

  it('sin producción el total es cero', () => {
    expect(sumProductionAmounts([])).toBe(0n)
  })

  it('días × costo diario, exacto', () => {
    expect(toDecimalString(equipmentTotal(3, toCents('450.00')))).toBe('1350.00')
    expect(toDecimalString(equipmentTotal(0, toCents('450.00')))).toBe('0.00')
  })

  it('días negativos revientan en vez de pagar al revés', () => {
    expect(() => equipmentTotal(-1, toCents('450.00'))).toThrow()
  })
})
