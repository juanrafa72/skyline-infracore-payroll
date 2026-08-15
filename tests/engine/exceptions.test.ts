import { describe, expect, it } from 'vitest'
import { ayudaDe, bloquea, origen } from '@/lib/payroll/exceptions'

/**
 * Qué avisos frenan un pago y cuáles no.
 *
 * La regla nació de un callejón sin salida real: los avisos que trajo la
 * importación del Excel contaban como «errores que bloquean», y como no había
 * ninguna pantalla para cerrarlos, la nómina quedaba trancada para siempre.
 */

const base = {
  level: 'CRITICAL',
  status: 'OPEN',
  code: 'CHANGED_AFTER_APPROVAL',
  entityType: 'WorkerPayroll',
  entityId: 'wp-1',
}

describe('qué avisos frenan un pago', () => {
  it('un cambio después de aprobar sí frena: hay que revisar los números otra vez', () => {
    expect(bloquea(base)).toBe(true)
  })

  it('lo que trajo el Excel NO frena, aunque sea crítico', () => {
    // Este era el bloqueo sin salida: días duplicados del histórico —que ya se
    // pagó por fuera— impedían aprobar una semana nueva sin relación con ellos.
    expect(
      bloquea({
        ...base,
        code: 'DUPLICATE_WORK_ENTRY',
        entityType: 'ImportBatch',
        entityId: null,
      }),
    ).toBe(false)

    expect(
      bloquea({
        ...base,
        code: 'CROSS_COMPANY_DUPLICATE',
        entityType: 'ImportBatch',
        entityId: null,
      }),
    ).toBe(false)
  })

  it('un aviso ya cerrado deja de frenar — el punto de poder cerrarlos', () => {
    expect(bloquea({ ...base, status: 'RESOLVED' })).toBe(false)
    expect(bloquea({ ...base, status: 'DISMISSED' })).toBe(false)
    expect(bloquea({ ...base, status: 'ACKNOWLEDGED' })).toBe(false)
  })

  it('lo que solo pide revisión no frena', () => {
    expect(bloquea({ ...base, level: 'REVIEW_REQUIRED' })).toBe(false)
    expect(bloquea({ ...base, level: 'WARNING' })).toBe(false)
  })

  it('un aviso sin dueño no puede frenar a nadie en concreto', () => {
    expect(bloquea({ ...base, entityId: null })).toBe(false)
  })

  it('un aviso de cuadrilla o de equipo frena igual que el de una persona', () => {
    expect(bloquea({ ...base, entityType: 'CrewPayroll', entityId: 'cp-1' })).toBe(true)
    expect(bloquea({ ...base, entityType: 'EquipmentPayroll', entityId: 'ep-1' })).toBe(true)
  })
})

describe('de dónde salió el aviso', () => {
  it('todo lo del lote de importación es del histórico', () => {
    expect(origen('CUALQUIER_COSA', 'ImportBatch')).toBe('IMPORT')
  })

  it('los códigos del Excel son del histórico aunque cambie la tabla', () => {
    expect(origen('DUPLICATE_WORKER', 'Worker')).toBe('IMPORT')
    expect(origen('REVIEW_ENTITY_TYPE', 'Worker')).toBe('IMPORT')
  })

  it('lo que produce el cálculo es trabajo de la semana', () => {
    expect(origen('CHANGED_AFTER_APPROVAL', 'WorkerPayroll')).toBe('TRABAJO')
  })
})

describe('la explicación en palabras del negocio', () => {
  it('cada aviso conocido dice qué pasó y qué hacer', () => {
    for (const code of [
      'CHANGED_AFTER_APPROVAL',
      'DUPLICATE_WORK_ENTRY',
      'CROSS_COMPANY_DUPLICATE',
      'DUPLICATE_WORKER',
      'REVIEW_ENTITY_TYPE',
    ]) {
      const ayuda = ayudaDe(code)
      expect(ayuda.queEs.length).toBeGreaterThan(20)
      expect(ayuda.queHacer.length).toBeGreaterThan(20)
    }
  })

  it('un código que nadie previó igual trae texto, no el código en inglés', () => {
    const ayuda = ayudaDe('ALGO_QUE_NO_EXISTE')
    expect(ayuda.queEs).not.toContain('ALGO_QUE_NO_EXISTE')
    expect(ayuda.queHacer.length).toBeGreaterThan(10)
  })
})
