import { describe, expect, it } from 'vitest'
import {
  diasEntre,
  estadoDe,
  ordenarPorUrgencia,
  requiereAtencion,
  type DocumentoEquipo,
} from '@/lib/equipment/records'

/**
 * Avisar ANTES de que se venza un seguro, que es lo que pidió el negocio.
 * La fecha de hoy entra como dato: una regla que consulta el reloj por su
 * cuenta cambia de resultado mañana y no se puede probar.
 */

const HOY = '2026-08-15'

const poliza = (expiresAt: string | null, alertDaysBefore = 30): DocumentoEquipo => ({
  kind: 'INSURANCE',
  expiresAt,
  alertDaysBefore,
  active: true,
})

describe('cuándo avisa un seguro', () => {
  it('vigente y lejos: no molesta', () => {
    const r = estadoDe(poliza('2026-12-31'), HOY)
    expect(r.estado).toBe('VIGENTE')
    expect(requiereAtencion(poliza('2026-12-31'), HOY)).toBe(false)
  })

  it('dentro del plazo de aviso: avisa', () => {
    // Faltan 20 días, avisa con 30.
    const r = estadoDe(poliza('2026-09-04'), HOY)
    expect(r.estado).toBe('POR_VENCER')
    expect(r.diasRestantes).toBe(20)
    expect(r.mensaje).toBe('Vence en 20 días.')
  })

  it('justo en el borde del plazo: avisa', () => {
    // 30 días exactos con aviso de 30: entra.
    expect(estadoDe(poliza('2026-09-14'), HOY).estado).toBe('POR_VENCER')
    // 31 días: todavía no.
    expect(estadoDe(poliza('2026-09-15'), HOY).estado).toBe('VIGENTE')
  })

  it('vence hoy: lo dice sin rodeos', () => {
    const r = estadoDe(poliza('2026-08-15'), HOY)
    expect(r.estado).toBe('POR_VENCER')
    expect(r.mensaje).toBe('Vence HOY.')
  })

  it('vence mañana', () => {
    expect(estadoDe(poliza('2026-08-16'), HOY).mensaje).toBe('Vence mañana.')
  })

  it('vencido: dice cuántos días lleva y que el equipo está descubierto', () => {
    const r = estadoDe(poliza('2026-08-05'), HOY)
    expect(r.estado).toBe('VENCIDO')
    expect(r.diasRestantes).toBe(-10)
    expect(r.mensaje).toContain('hace 10 días')
    expect(r.mensaje).toContain('sin esto')
  })

  it('venció ayer', () => {
    expect(estadoDe(poliza('2026-08-14'), HOY).mensaje).toBe('Venció ayer.')
  })

  it('cada documento puede pedir su propia anticipación', () => {
    // Un cambio de aceite avisa con 7 días, no con 30.
    const aceite: DocumentoEquipo = {
      kind: 'MAINTENANCE',
      expiresAt: '2026-09-04',
      alertDaysBefore: 7,
      active: true,
    }
    expect(estadoDe(aceite, HOY).estado).toBe('VIGENTE')
  })
})

describe('lo que NO debe avisar', () => {
  it('un título de propiedad no vence: no es lo mismo que estar vencido', () => {
    const titulo: DocumentoEquipo = {
      kind: 'TITLE',
      expiresAt: null,
      alertDaysBefore: 0,
      active: true,
    }
    expect(estadoDe(titulo, HOY).estado).toBe('SIN_VENCIMIENTO')
    expect(requiereAtencion(titulo, HOY)).toBe(false)
  })

  it('una póliza reemplazada por su renovación deja de gritar', () => {
    // Si avisara, cada póliza vieja de un camión avisaría para siempre.
    const vieja = { ...poliza('2025-01-01'), active: false }
    expect(estadoDe(vieja, HOY).estado).toBe('SIN_VENCIMIENTO')
    expect(requiereAtencion(vieja, HOY)).toBe(false)
  })
})

describe('el orden en que se muestran', () => {
  it('primero lo vencido, después lo que está por vencer, lo urgente arriba', () => {
    const documentos = [
      { ...poliza('2026-12-31'), kind: 'INSPECTION' as const }, // vigente
      { ...poliza(null), kind: 'TITLE' as const }, // sin vencimiento
      { ...poliza('2026-08-20'), kind: 'REGISTRATION' as const }, // por vencer en 5
      { ...poliza('2026-07-01'), kind: 'INSURANCE' as const }, // vencido hace 45
      { ...poliza('2026-08-25'), kind: 'MAINTENANCE' as const }, // por vencer en 10
      { ...poliza('2026-08-10'), kind: 'WARRANTY' as const }, // vencido hace 5
    ]
    expect(ordenarPorUrgencia(documentos, HOY).map((d) => d.kind)).toEqual([
      'INSURANCE', // el más vencido primero
      'WARRANTY',
      'REGISTRATION', // el más próximo a vencer
      'MAINTENANCE',
      'INSPECTION',
      'TITLE',
    ])
  })
})

describe('la aritmética de fechas', () => {
  it('cuenta días enteros', () => {
    expect(diasEntre('2026-08-15', '2026-08-20')).toBe(5)
    expect(diasEntre('2026-08-20', '2026-08-15')).toBe(-5)
    expect(diasEntre('2026-08-15', '2026-08-15')).toBe(0)
  })

  it('cruza meses y años sin equivocarse', () => {
    expect(diasEntre('2026-12-25', '2027-01-05')).toBe(11)
    expect(diasEntre('2026-01-31', '2026-03-01')).toBe(29)
  })

  it('cuenta bien el 29 de febrero de un año bisiesto', () => {
    expect(diasEntre('2028-02-28', '2028-03-01')).toBe(2)
  })
})
