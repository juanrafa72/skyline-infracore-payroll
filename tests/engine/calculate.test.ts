import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  calculateWorkerPayroll,
  resolveRate,
  toCents,
  toDecimalString,
} from '@/lib/payroll/engine'
import type {
  AdvanceInput,
  CalculationInput,
  DebtInput,
  RateInput,
  WorkEntryInput,
} from '@/lib/payroll/engine'

const WEEK = ['2026-07-19', '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25']

function rate(overrides: Partial<RateInput> = {}): RateInput {
  return {
    id: 'rate-1',
    rateType: 'DAILY',
    amount: toCents('200.00'),
    shift: 'ANY',
    projectId: null,
    operationId: null,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...overrides,
  }
}

function entry(date: string, overrides: Partial<WorkEntryInput> = {}): WorkEntryInput {
  return {
    id: `we-${date}`,
    workDate: date,
    dayType: 'FULL_DAY',
    hoursWorked: null,
    shift: 'DAY',
    projectId: null,
    crewId: null,
    operationId: null,
    ...overrides,
  }
}

function input(overrides: Partial<CalculationInput> = {}): CalculationInput {
  return {
    workerId: 'w1',
    compensationType: 'DAILY_RATE',
    fixedWeeklyAmount: null,
    entries: [],
    rates: [rate()],
    additions: [],
    manualDeductions: [],
    advances: [],
    debts: [],
    settings: DEFAULT_SETTINGS,
    ...overrides,
  }
}

describe('pago por día — el caso real de FEDERICO QUINTERO UG, semana 30', () => {
  it('7 días completos a $200 = $1.400', () => {
    const result = calculateWorkerPayroll(
      input({ entries: WEEK.map((d) => entry(d)) }),
    )
    expect(toDecimalString(result.basePay)).toBe('1400.00')
    expect(toDecimalString(result.netPay)).toBe('1400.00')
    expect(result.daysFull).toBe(7)
    expect(result.exceptions).toHaveLength(0)
  })
})

describe('tipos de día', () => {
  it('medio día paga exactamente la mitad — BR-022', () => {
    const result = calculateWorkerPayroll(
      input({
        rates: [rate({ amount: toCents('143.00') })],
        entries: [entry(WEEK[0]!, { dayType: 'HALF_DAY' })],
      }),
    )
    expect(toDecimalString(result.basePay)).toBe('71.50')
    expect(result.daysHalf).toBe(1)
  })

  it('día no trabajado paga cero y no cuenta como trabajado', () => {
    const result = calculateWorkerPayroll(
      input({ entries: [entry(WEEK[0]!, { dayType: 'NO_WORK' })] }),
    )
    expect(toDecimalString(result.basePay)).toBe('0.00')
    expect(result.daysNoWork).toBe(1)
    expect(result.daysFull).toBe(0)
  })

  it('paga los días no trabajados si la regla A15 se activa', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: [entry(WEEK[0]!, { dayType: 'NO_WORK' })],
        settings: { ...DEFAULT_SETTINGS, payNoWorkDays: true },
      }),
    )
    expect(toDecimalString(result.basePay)).toBe('0.00')
  })

  it('el día OTHER no genera línea de pago', () => {
    const result = calculateWorkerPayroll(
      input({ entries: [entry(WEEK[0]!, { dayType: 'OTHER' })] }),
    )
    expect(result.lines).toHaveLength(0)
  })

  it('semana mixta: 4 completos + 1 medio + 2 sin trabajo', () => {
    const result = calculateWorkerPayroll(
      input({
        rates: [rate({ amount: toCents('190.00') })],
        entries: [
          entry(WEEK[0]!),
          entry(WEEK[1]!),
          entry(WEEK[2]!),
          entry(WEEK[3]!),
          entry(WEEK[4]!, { dayType: 'HALF_DAY' }),
          entry(WEEK[5]!, { dayType: 'NO_WORK' }),
          entry(WEEK[6]!, { dayType: 'NO_WORK' }),
        ],
      }),
    )
    expect(toDecimalString(result.basePay)).toBe('855.00') // 4×190 + 95
    expect(result.daysFull).toBe(4)
    expect(result.daysHalf).toBe(1)
    expect(result.daysNoWork).toBe(2)
  })
})

describe('pago por hora — las horas se capturan, no se derivan', () => {
  it('7,25 horas a $18,50', () => {
    const result = calculateWorkerPayroll(
      input({
        compensationType: 'HOURLY',
        rates: [rate({ rateType: 'HOURLY', amount: toCents('18.50') })],
        entries: [entry(WEEK[0]!, { dayType: 'HOURLY', hoursWorked: '7.25' })],
      }),
    )
    expect(toDecimalString(result.basePay)).toBe('134.13')
    expect(result.hoursTotal).toBe('7.25')
  })

  it('acumula las horas de la semana', () => {
    const result = calculateWorkerPayroll(
      input({
        rates: [rate({ rateType: 'HOURLY', amount: toCents('20.00') })],
        entries: [
          entry(WEEK[0]!, { dayType: 'HOURLY', hoursWorked: '8' }),
          entry(WEEK[1]!, { dayType: 'HOURLY', hoursWorked: '6.5' }),
        ],
      }),
    )
    expect(result.hoursTotal).toBe('14.50')
    expect(toDecimalString(result.basePay)).toBe('290.00')
  })
})

describe('tarifa faltante — corrige el bug de los Excel (C3)', () => {
  it('NO paga cero en silencio: genera MISSING_RATE crítica — BR-033', () => {
    const result = calculateWorkerPayroll(
      input({ rates: [], entries: [entry(WEEK[0]!)] }),
    )
    expect(toDecimalString(result.basePay)).toBe('0.00')
    expect(result.exceptions).toHaveLength(1)
    expect(result.exceptions[0]!.code).toBe('MISSING_RATE')
    expect(result.exceptions[0]!.level).toBe('CRITICAL')
  })

  it('una tarifa vencida no aplica', () => {
    const result = calculateWorkerPayroll(
      input({
        rates: [rate({ effectiveFrom: '2025-01-01', effectiveTo: '2026-01-01' })],
        entries: [entry(WEEK[0]!)],
      }),
    )
    expect(result.exceptions[0]!.code).toBe('MISSING_RATE')
  })
})

describe('historial de tarifas — resuelve el truco del sufijo (JAIRO MEJIA / JAIRO MEJIA1)', () => {
  const rates: RateInput[] = [
    rate({ id: 'r-350', amount: toCents('350.00'), effectiveFrom: '2026-01-01', effectiveTo: '2026-06-01' }),
    rate({ id: 'r-400', amount: toCents('400.00'), effectiveFrom: '2026-06-01', effectiveTo: null }),
  ]

  it('un día de marzo usa $350', () => {
    const found = resolveRate(rates, {
      workDate: '2026-03-15',
      rateType: 'DAILY',
      shift: 'DAY',
      projectId: null,
      operationId: null,
    })
    expect(found?.id).toBe('r-350')
  })

  it('un día de julio usa $400', () => {
    const found = resolveRate(rates, {
      workDate: '2026-07-20',
      rateType: 'DAILY',
      shift: 'DAY',
      projectId: null,
      operationId: null,
    })
    expect(found?.id).toBe('r-400')
  })

  it('cambiar la tarifa hoy no altera una nómina de marzo — BR-032', () => {
    const marzo = calculateWorkerPayroll(
      input({ rates, entries: [entry('2026-03-15')] }),
    )
    expect(toDecimalString(marzo.basePay)).toBe('350.00')
    expect(toDecimalString(marzo.lines[0]!.appliedRate)).toBe('350.00')
    expect(marzo.lines[0]!.rateSourceId).toBe('r-350')
  })
})

describe('tarifa nocturna — NOVASITE $400 día / $440 noche', () => {
  const rates: RateInput[] = [
    rate({ id: 'r-day', amount: toCents('400.00'), shift: 'DAY' }),
    rate({ id: 'r-night', amount: toCents('440.00'), shift: 'NIGHT' }),
  ]

  it('el turno noche usa su propia tarifa, no un porcentaje — BR-036', () => {
    const result = calculateWorkerPayroll(
      input({
        rates,
        entries: [entry(WEEK[0]!, { shift: 'NIGHT' }), entry(WEEK[1]!, { shift: 'DAY' })],
      }),
    )
    expect(toDecimalString(result.basePay)).toBe('840.00')
  })

  it('la tarifa de proyecto gana sobre la general', () => {
    const found = resolveRate(
      [
        rate({ id: 'general', amount: toCents('190.00') }),
        rate({ id: 'proyecto', amount: toCents('250.00'), projectId: 'p1' }),
      ],
      { workDate: WEEK[0]!, rateType: 'DAILY', shift: 'DAY', projectId: 'p1', operationId: null },
    )
    expect(found?.id).toBe('proyecto')
  })

  it('proyecto + turno gana sobre solo proyecto', () => {
    const found = resolveRate(
      [
        rate({ id: 'solo-proyecto', projectId: 'p1' }),
        rate({ id: 'proyecto-noche', projectId: 'p1', shift: 'NIGHT' }),
      ],
      { workDate: WEEK[0]!, rateType: 'DAILY', shift: 'NIGHT', projectId: 'p1', operationId: null },
    )
    expect(found?.id).toBe('proyecto-noche')
  })
})

describe('pago semanal fijo', () => {
  it('no depende de los días trabajados — BR-041', () => {
    const result = calculateWorkerPayroll(
      input({
        compensationType: 'FIXED_WEEKLY',
        fixedWeeklyAmount: toCents('1000.00'),
        entries: [entry(WEEK[0]!), entry(WEEK[1]!, { dayType: 'NO_WORK' })],
      }),
    )
    expect(toDecimalString(result.basePay)).toBe('1000.00')
  })

  it('sin monto configurado genera MISSING_RATE', () => {
    const result = calculateWorkerPayroll(
      input({ compensationType: 'FIXED_WEEKLY', fixedWeeklyAmount: null }),
    )
    expect(result.exceptions[0]!.code).toBe('MISSING_RATE')
  })
})

describe('adicionales y descuentos', () => {
  it('el bruto es base más adicionales — BR-051', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: [entry(WEEK[0]!)],
        additions: [
          { id: 'a1', category: 'COMPLETION_BONUS', amount: toCents('120.00'), description: 'Bono' },
          { id: 'a2', category: 'PER_DIEM', amount: toCents('45.50'), description: 'Viáticos' },
        ],
      }),
    )
    expect(toDecimalString(result.additionsTotal)).toBe('165.50')
    expect(toDecimalString(result.grossPay)).toBe('365.50')
  })

  it('el neto es bruto menos descuentos — BR-052', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: [entry(WEEK[0]!)],
        manualDeductions: [
          { id: 'd1', category: 'HOTEL', amount: toCents('60.00'), description: 'Hotel semana 29' },
        ],
      }),
    )
    expect(toDecimalString(result.netPay)).toBe('140.00')
  })
})

describe('recuperación de anticipos', () => {
  function advance(overrides: Partial<AdvanceInput> = {}): AdvanceInput {
    return {
      id: 'adv-1',
      balance: toCents('1000.00'),
      recoveryMethod: 'FIXED_WEEKLY',
      recoveryAmount: toCents('250.00'),
      recoveryPct: null,
      recoveryCap: null,
      paused: false,
      ...overrides,
    }
  }

  it('monto fijo semanal', () => {
    const result = calculateWorkerPayroll(
      input({ entries: WEEK.map((d) => entry(d)), advances: [advance()] }),
    )
    expect(toDecimalString(result.deductionsTotal)).toBe('250.00')
    expect(toDecimalString(result.netPay)).toBe('1150.00')
  })

  it('nunca recupera más que el saldo — BR-087', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: WEEK.map((d) => entry(d)),
        advances: [advance({ balance: toCents('100.00'), recoveryAmount: toCents('250.00') })],
      }),
    )
    expect(toDecimalString(result.deductionsTotal)).toBe('100.00')
  })

  it('porcentaje del bruto', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: WEEK.map((d) => entry(d)),
        advances: [advance({ recoveryMethod: 'PERCENTAGE_OF_NET', recoveryAmount: null, recoveryPct: '10' })],
      }),
    )
    expect(toDecimalString(result.deductionsTotal)).toBe('140.00')
  })

  it('porcentaje con tope', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: WEEK.map((d) => entry(d)),
        advances: [
          advance({
            recoveryMethod: 'PERCENTAGE_WITH_CAP',
            recoveryAmount: null,
            recoveryPct: '50',
            recoveryCap: toCents('300.00'),
          }),
        ],
      }),
    )
    expect(toDecimalString(result.deductionsTotal)).toBe('300.00')
  })

  it('un anticipo pausado no descuenta — BR-086', () => {
    const result = calculateWorkerPayroll(
      input({ entries: WEEK.map((d) => entry(d)), advances: [advance({ paused: true })] }),
    )
    expect(toDecimalString(result.deductionsTotal)).toBe('0.00')
  })

  it('recuperación total con LUMP_SUM', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: WEEK.map((d) => entry(d)),
        advances: [advance({ recoveryMethod: 'LUMP_SUM', balance: toCents('500.00') })],
      }),
    )
    expect(toDecimalString(result.deductionsTotal)).toBe('500.00')
  })

  it('MANUAL no genera recuperación automática', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: WEEK.map((d) => entry(d)),
        advances: [advance({ recoveryMethod: 'MANUAL', recoveryAmount: null })],
      }),
    )
    expect(toDecimalString(result.deductionsTotal)).toBe('0.00')
  })

  it('no recupera más de lo que queda por pagar', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: [entry(WEEK[0]!)], // bruto 200
        advances: [advance({ recoveryAmount: toCents('900.00') })],
      }),
    )
    expect(toDecimalString(result.deductionsTotal)).toBe('200.00')
    expect(toDecimalString(result.netPay)).toBe('0.00')
  })
})

describe('recuperación de deudas', () => {
  function debt(overrides: Partial<DebtInput> = {}): DebtInput {
    return {
      id: 'debt-1',
      balance: toCents('800.00'),
      recoveryRule: 'FIXED_WEEKLY',
      recoveryAmount: toCents('100.00'),
      recoveryPct: null,
      recoveryCap: null,
      ...overrides,
    }
  }

  it('descuenta el monto fijo', () => {
    const result = calculateWorkerPayroll(
      input({ entries: WEEK.map((d) => entry(d)), debts: [debt()] }),
    )
    expect(toDecimalString(result.deductionsTotal)).toBe('100.00')
  })

  it('una deuda pausada no descuenta', () => {
    const result = calculateWorkerPayroll(
      input({ entries: WEEK.map((d) => entry(d)), debts: [debt({ recoveryRule: 'PAUSED' })] }),
    )
    expect(toDecimalString(result.deductionsTotal)).toBe('0.00')
  })

  it('el anticipo se recupera antes que la deuda — BR-056', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: [entry(WEEK[0]!)], // bruto 200
        advances: [
          {
            id: 'adv',
            balance: toCents('500.00'),
            recoveryMethod: 'FIXED_WEEKLY',
            recoveryAmount: toCents('150.00'),
            recoveryPct: null,
            recoveryCap: null,
            paused: false,
          },
        ],
        debts: [debt({ recoveryAmount: toCents('150.00') })],
      }),
    )
    expect(result.deductions[0]!.category).toBe('ADVANCE_RECOVERY')
    expect(toDecimalString(result.deductions[0]!.amount)).toBe('150.00')
    expect(result.deductions[1]!.category).toBe('DEBT_RECOVERY')
    expect(toDecimalString(result.deductions[1]!.amount)).toBe('50.00') // solo lo que quedaba
    expect(toDecimalString(result.netPay)).toBe('0.00')
  })
})

describe('neto negativo — A10', () => {
  it('lo limita a cero y arrastra el excedente', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: [entry(WEEK[0]!)], // bruto 200
        manualDeductions: [
          { id: 'd', category: 'DAMAGE', amount: toCents('327.59'), description: 'Daño equipo' },
        ],
      }),
    )
    expect(toDecimalString(result.netPay)).toBe('0.00')
    expect(toDecimalString(result.carriedForward)).toBe('127.59')
    expect(result.exceptions.map((e) => e.code)).toContain('NEGATIVE_PAYROLL')
  })

  it('permite el negativo si la regla se cambia', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: [entry(WEEK[0]!)],
        manualDeductions: [
          { id: 'd', category: 'DAMAGE', amount: toCents('327.59'), description: 'Daño' },
        ],
        settings: { ...DEFAULT_SETTINGS, negativeNetBehavior: 'ALLOW_NEGATIVE' },
      }),
    )
    expect(toDecimalString(result.netPay)).toBe('-127.59')
    expect(toDecimalString(result.carriedForward)).toBe('0.00')
  })
})

describe('determinismo — BR-054', () => {
  it('cien ejecuciones del mismo caso complejo dan idéntico resultado', () => {
    const scenario = input({
      rates: [rate({ amount: toCents('143.00') })],
      entries: [
        entry(WEEK[0]!),
        entry(WEEK[1]!, { dayType: 'HALF_DAY' }),
        entry(WEEK[2]!),
        entry(WEEK[3]!, { dayType: 'NO_WORK' }),
      ],
      additions: [{ id: 'a', category: 'BONUS', amount: toCents('37.33'), description: 'Bono' }],
      manualDeductions: [{ id: 'd', category: 'HOTEL', amount: toCents('19.99'), description: 'Hotel' }],
      advances: [
        {
          id: 'adv',
          balance: toCents('1000.00'),
          recoveryMethod: 'PERCENTAGE_WITH_CAP',
          recoveryAmount: null,
          recoveryPct: '7.5',
          recoveryCap: toCents('40.00'),
          paused: false,
        },
      ],
    })

    const results = new Set<string>()
    for (let i = 0; i < 100; i += 1) {
      results.add(toDecimalString(calculateWorkerPayroll(scenario).netPay))
    }
    expect(results.size).toBe(1)
  })
})

describe('adicional marcado día por día', () => {
  it('suma el adicional al bruto y lo describe con su nota', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: [
          entry(WEEK[0]!),
          entry(WEEK[1]!, {
            additionalAmount: toCents('75.00'),
            additionalNote: 'se quedó cerrando el tramo',
          }),
        ],
      }),
    )
    expect(toDecimalString(result.basePay)).toBe('400.00')
    expect(toDecimalString(result.additionsTotal)).toBe('75.00')
    expect(toDecimalString(result.netPay)).toBe('475.00')
    expect(result.additions[0]!.description).toContain('se quedó cerrando el tramo')
  })

  it('NO paga un adicional sin nota: lo reporta como error', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: [entry(WEEK[0]!, { additionalAmount: toCents('75.00'), additionalNote: null })],
      }),
    )
    expect(toDecimalString(result.additionsTotal)).toBe('0.00')
    expect(result.exceptions.map((e) => e.code)).toContain('UNUSUAL_ADDITION')
    expect(result.exceptions.find((e) => e.code === 'UNUSUAL_ADDITION')!.level).toBe('CRITICAL')
  })

  it('ignora una nota en blanco igual que si no existiera', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: [entry(WEEK[0]!, { additionalAmount: toCents('50.00'), additionalNote: '   ' })],
      }),
    )
    expect(toDecimalString(result.additionsTotal)).toBe('0.00')
    expect(result.exceptions.map((e) => e.code)).toContain('UNUSUAL_ADDITION')
  })

  it('un adicional en medio día también cuenta', () => {
    const result = calculateWorkerPayroll(
      input({
        rates: [rate({ amount: toCents('200.00') })],
        entries: [
          entry(WEEK[0]!, {
            dayType: 'HALF_DAY',
            additionalAmount: toCents('30.00'),
            additionalNote: 'viaje',
          }),
        ],
      }),
    )
    expect(toDecimalString(result.basePay)).toBe('100.00')
    expect(toDecimalString(result.netPay)).toBe('130.00')
  })

  it('convive con los adicionales de la semana', () => {
    const result = calculateWorkerPayroll(
      input({
        entries: [entry(WEEK[0]!, { additionalAmount: toCents('25.00'), additionalNote: 'extra' })],
        additions: [{ id: 'a', category: 'BONUS', amount: toCents('100.00'), description: 'Bono' }],
      }),
    )
    expect(toDecimalString(result.additionsTotal)).toBe('125.00')
    expect(result.additions).toHaveLength(2)
  })
})
