import { describe, expect, it } from 'vitest'
import {
  EDITABLE,
  FROZEN,
  TRANSITIONS,
  approvalIsStale,
  assertTransition,
  calculationHash,
  isSelfApproval,
  type MaterialFields,

  type WorkflowAction,
} from '@/lib/payroll/workflow'

const LEO = 'user-leo'
const RAFAEL = 'user-rafael'
const TESORERIA = 'user-tesoreria'

const ALL_PERMISSIONS = new Set([
  'payroll:edit', 'payroll:submit', 'payroll:approve', 'payroll:reject',
  'payroll:return', 'payroll:close', 'payment:execute',
])

function check(overrides: Partial<Parameters<typeof assertTransition>[0]> = {}) {
  return assertTransition({
    action: 'APPROVE',
    current: 'PENDING_APPROVAL',
    actorId: RAFAEL,
    permissions: ALL_PERMISSIONS,
    preparedById: LEO,
    approvedById: null,
    ...overrides,
  })
}

describe('el camino normal', () => {
  it('Leo calcula, envía; Rafael aprueba; tesorería paga', () => {
    expect(check({ action: 'CALCULATE', current: 'DRAFT', actorId: LEO })).toBe('PREPARED')
    expect(check({ action: 'SUBMIT', current: 'PREPARED', actorId: LEO })).toBe('PENDING_APPROVAL')
    expect(check({ action: 'APPROVE', current: 'PENDING_APPROVAL', actorId: RAFAEL })).toBe('APPROVED')
    expect(
      check({
        action: 'START_PAYMENT',
        current: 'APPROVED',
        actorId: TESORERIA,
        approvedById: RAFAEL,
      }),
    ).toBe('PAYMENT_IN_PROCESS')
    expect(
      check({
        action: 'CONFIRM_PAYMENT',
        current: 'PAYMENT_IN_PROCESS',
        actorId: TESORERIA,
        approvedById: RAFAEL,
      }),
    ).toBe('PAID')
    expect(check({ action: 'RECONCILE', current: 'PAID', actorId: RAFAEL })).toBe('RECONCILED')
    expect(check({ action: 'CLOSE', current: 'RECONCILED', actorId: RAFAEL })).toBe('CLOSED')
  })
})

describe('segregación de funciones — se comprueba por PERSONA, no por rol', () => {
  it('Leo no puede aprobar lo que él preparó, aunque tenga el permiso', () => {
    expect(() =>
      check({ action: 'APPROVE', actorId: LEO, preparedById: LEO }),
    ).toThrow(/tú mismo preparaste/)
  })

  it('tampoco puede rechazarlo', () => {
    expect(() =>
      check({ action: 'REJECT', actorId: LEO, preparedById: LEO, reason: 'no' }),
    ).toThrow(/tú mismo preparaste/)
  })

  it('un administrador con todos los permisos tampoco se salta la regla', () => {
    expect(() =>
      check({ action: 'APPROVE', actorId: LEO, preparedById: LEO, permissions: ALL_PERMISSIONS }),
    ).toThrow(/tú mismo preparaste/)
  })

  it('quien aprobó no puede ejecutar el pago', () => {
    expect(() =>
      check({
        action: 'START_PAYMENT',
        current: 'APPROVED',
        actorId: RAFAEL,
        approvedById: RAFAEL,
      }),
    ).toThrow(/tú mismo aprobaste/)
  })

  it('ni confirmarlo', () => {
    expect(() =>
      check({
        action: 'CONFIRM_PAYMENT',
        current: 'PAYMENT_IN_PROCESS',
        actorId: RAFAEL,
        approvedById: RAFAEL,
      }),
    ).toThrow(/tú mismo aprobaste/)
  })

  it('otra persona sí puede', () => {
    expect(
      check({ action: 'APPROVE', actorId: RAFAEL, preparedById: LEO }),
    ).toBe('APPROVED')
  })
})

describe('permisos', () => {
  it('sin permiso de aprobar, no aprueba', () => {
    expect(() =>
      check({ permissions: new Set(['payroll:edit', 'payroll:submit']) }),
    ).toThrow(/No tienes permiso para aprobar/)
  })

  it('tesorería no puede aprobar', () => {
    expect(() =>
      check({ actorId: TESORERIA, permissions: new Set(['payment:execute']) }),
    ).toThrow(/No tienes permiso/)
  })

  it('quien prepara no puede pagar', () => {
    expect(() =>
      check({
        action: 'START_PAYMENT',
        current: 'APPROVED',
        actorId: LEO,
        permissions: new Set(['payroll:edit', 'payroll:submit']),
      }),
    ).toThrow(/No tienes permiso/)
  })
})

describe('estados de origen', () => {
  it('no se aprueba un borrador', () => {
    expect(() => check({ current: 'DRAFT' })).toThrow(/No se puede aprobar/)
  })

  it('no se aprueba dos veces', () => {
    expect(() => check({ current: 'APPROVED' })).toThrow(/No se puede aprobar/)
  })

  it('no se paga algo sin aprobar', () => {
    expect(() =>
      check({ action: 'START_PAYMENT', current: 'PREPARED', actorId: TESORERIA }),
    ).toThrow(/No se puede iniciar el pago/)
  })

  it('una nómina pagada no vuelve atrás por ninguna acción', () => {
    for (const action of Object.keys(TRANSITIONS) as WorkflowAction[]) {
      if (action === 'RECONCILE') continue // PAID → RECONCILED sí es válido
      expect(() =>
        check({ action, current: 'PAID', actorId: TESORERIA, reason: 'x' }),
      ).toThrow()
    }
  })

  it('una nómina cerrada es intocable', () => {
    for (const action of Object.keys(TRANSITIONS) as WorkflowAction[]) {
      expect(() =>
        check({ action, current: 'CLOSED', actorId: RAFAEL, reason: 'x' }),
      ).toThrow()
    }
  })

  it('el histórico importado no entra al flujo', () => {
    for (const action of Object.keys(TRANSITIONS) as WorkflowAction[]) {
      expect(() =>
        check({ action, current: 'IMPORTED_HISTORICAL', actorId: RAFAEL, reason: 'x' }),
      ).toThrow()
    }
  })
})

describe('motivos obligatorios', () => {
  it('rechazar exige motivo', () => {
    expect(() => check({ action: 'REJECT' })).toThrow(/hay que escribir el motivo/)
    expect(() => check({ action: 'REJECT', reason: '   ' })).toThrow(/motivo/)
    expect(check({ action: 'REJECT', reason: 'faltan los días de Mario' })).toBe('REJECTED')
  })

  it('devolver exige motivo', () => {
    expect(() =>
      check({ action: 'RETURN', current: 'APPROVED' }),
    ).toThrow(/hay que escribir el motivo/)
    expect(
      check({ action: 'RETURN', current: 'APPROVED', reason: 'la tarifa está mal' }),
    ).toBe('PENDING_APPROVAL')
  })

  it('tesorería puede devolver lo aprobado si ve un error', () => {
    expect(
      check({
        action: 'RETURN',
        current: 'READY_TO_PAY',
        actorId: TESORERIA,
        reason: 'el monto no cuadra',
      }),
    ).toBe('PENDING_APPROVAL')
  })
})

describe('listas de estados', () => {
  it('editables y congelados no se cruzan', () => {
    for (const status of FROZEN) {
      expect(EDITABLE).not.toContain(status)
    }
  })
})

// ─────────────────────────────────────────────────────────────

function fields(overrides: Partial<MaterialFields> = {}): MaterialFields {
  return {
    workerId: 'w1',
    days: [
      {
        date: '2026-07-20',
        dayType: 'FULL_DAY',
        hours: null,
        shift: 'DAY',
        projectId: 'p1',
        crewId: null,
        additionalAmount: null,
        additionalNote: null,
      },
    ],
    rates: [{ date: '2026-07-20', amount: '200.00', rateId: 'r1' }],
    additions: [],
    deductions: [],
    advanceRecoveries: [],
    debtRecoveries: [],
    grossPay: '200.00',
    netPay: '200.00',
    ...overrides,
  }
}

describe('huella de campos materiales — qué invalida una aprobación', () => {
  it('la misma información da la misma huella', () => {
    expect(calculationHash(fields())).toBe(calculationHash(fields()))
  })

  it('el orden no cambia la huella', () => {
    const a = fields({
      additions: [
        { category: 'BONUS', amount: '10.00', description: 'uno' },
        { category: 'TRAVEL', amount: '20.00', description: 'dos' },
      ],
    })
    const b = fields({
      additions: [
        { category: 'TRAVEL', amount: '20.00', description: 'dos' },
        { category: 'BONUS', amount: '10.00', description: 'uno' },
      ],
    })
    expect(calculationHash(a)).toBe(calculationHash(b))
  })

  const cambios: Array<[string, Partial<MaterialFields>]> = [
    ['el trabajador', { workerId: 'w2' }],
    ['los días', { days: [{ ...fields().days[0]!, dayType: 'HALF_DAY' }] }],
    ['las horas', { days: [{ ...fields().days[0]!, hours: '8' }] }],
    ['el turno', { days: [{ ...fields().days[0]!, shift: 'NIGHT' }] }],
    ['el proyecto', { days: [{ ...fields().days[0]!, projectId: 'p2' }] }],
    ['la cuadrilla', { days: [{ ...fields().days[0]!, crewId: 'c1' }] }],
    ['un adicional del día', { days: [{ ...fields().days[0]!, additionalAmount: '50.00' }] }],
    ['la tarifa', { rates: [{ date: '2026-07-20', amount: '250.00', rateId: 'r2' }] }],
    ['un adicional', { additions: [{ category: 'BONUS', amount: '10.00', description: 'x' }] }],
    ['un descuento', { deductions: [{ category: 'HOTEL', amount: '10.00', description: 'x' }] }],
    ['un anticipo', { advanceRecoveries: [{ advanceId: 'a1', amount: '50.00' }] }],
    ['una deuda', { debtRecoveries: [{ debtId: 'd1', amount: '50.00' }] }],
    ['el bruto', { grossPay: '300.00' }],
    ['el neto', { netPay: '150.00' }],
  ]

  for (const [what, change] of cambios) {
    it(`cambiar ${what} invalida la aprobación`, () => {
      const before = calculationHash(fields())
      const after = calculationHash(fields(change))
      expect(after).not.toBe(before)
      expect(approvalIsStale(before, after)).toBe(true)
    })
  }

  it('si nada cambió, la aprobación sigue válida', () => {
    const hash = calculationHash(fields())
    expect(approvalIsStale(hash, hash)).toBe(false)
  })

  it('una nómina sin aprobar nunca está "vencida"', () => {
    expect(approvalIsStale(null, calculationHash(fields()))).toBe(false)
  })

  it('un cambio que deja el mismo neto también invalida', () => {
    // Un día menos y un adicional que compensa: el neto queda igual,
    // pero lo aprobado ya no es lo que hay.
    const before = calculationHash(fields())
    const after = calculationHash(
      fields({
        days: [{ ...fields().days[0]!, dayType: 'HALF_DAY' }],
        additions: [{ category: 'BONUS', amount: '100.00', description: 'compensa' }],
      }),
    )
    expect(after).not.toBe(before)
  })
})

describe('modo de una sola persona (allowSelfApproval)', () => {
  it('apagado, sigue bloqueando aprobar lo propio', () => {
    expect(() =>
      check({ actorId: LEO, preparedById: LEO, allowSelfApproval: false }),
    ).toThrow(/tú mismo preparaste/)
  })

  it('encendido, deja aprobar lo propio', () => {
    expect(check({ actorId: LEO, preparedById: LEO, allowSelfApproval: true })).toBe('APPROVED')
  })

  it('encendido, deja pagar lo que uno aprobó', () => {
    expect(
      check({
        action: 'START_PAYMENT',
        current: 'APPROVED',
        actorId: RAFAEL,
        approvedById: RAFAEL,
        allowSelfApproval: true,
      }),
    ).toBe('PAYMENT_IN_PROCESS')
  })

  it('la acción queda identificada como sin segundo par de ojos', () => {
    expect(
      isSelfApproval({
        action: 'APPROVE',
        current: 'PENDING_APPROVAL',
        actorId: LEO,
        permissions: ALL_PERMISSIONS,
        preparedById: LEO,
      }),
    ).toBe(true)
  })

  it('cuando sí hubo dos personas, no se marca', () => {
    expect(
      isSelfApproval({
        action: 'APPROVE',
        current: 'PENDING_APPROVAL',
        actorId: RAFAEL,
        permissions: ALL_PERMISSIONS,
        preparedById: LEO,
      }),
    ).toBe(false)
  })

  it('encendido NO deja saltarse los permisos', () => {
    expect(() =>
      check({
        actorId: LEO,
        preparedById: LEO,
        allowSelfApproval: true,
        permissions: new Set(['payroll:edit']),
      }),
    ).toThrow(/No tienes permiso/)
  })

  it('encendido NO deja aprobar desde un estado inválido', () => {
    expect(() =>
      check({ current: 'PAID', actorId: LEO, preparedById: LEO, allowSelfApproval: true }),
    ).toThrow(/No se puede aprobar/)
  })
})
