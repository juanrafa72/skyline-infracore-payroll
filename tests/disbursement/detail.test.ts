/**
 * Contra qué se paga cada renglón — BR-195.
 *
 * La frase se escribe una sola vez y la leen tres sitios: el resumen antes de
 * aprobar, el centro de pagos y el PDF de contabilidad. Si dijeran cosas
 * distintas, el soporte y la pantalla dejarían de coincidir.
 */
import { describe, expect, it } from 'vitest'
import { crewDetail, equipmentDetail, workerDetail } from '@/lib/disbursement/detail'

describe('los días de una persona', () => {
  it('cinco días completos', () => {
    expect(workerDetail(5, 0)).toBe('5 días')
  })

  it('un solo día no dice «días»', () => {
    expect(workerDetail(1, 0)).toBe('1 día')
  })

  it('dos medios días son uno completo', () => {
    expect(workerDetail(4, 2)).toBe('5 días')
  })

  it('el medio suelto se ve', () => {
    expect(workerDetail(5, 1)).toBe('5½ días')
  })

  it('sin días marcados no dice nada: «0 días» junto a un monto es peor', () => {
    expect(workerDetail(0, 0)).toBeNull()
  })
})

describe('cuadrillas y equipos', () => {
  it('la producción de la cuadrilla', () => {
    expect(crewDetail(3)).toBe('3 registros de producción')
    expect(crewDetail(1)).toBe('1 registro de producción')
  })

  it('el alquiler del equipo lleva su costo diario', () => {
    expect(equipmentDetail(4, '450.00')).toBe('4 días × $450.00')
    expect(equipmentDetail(1, '1200.00')).toBe('1 día × $1,200.00')
  })
})
