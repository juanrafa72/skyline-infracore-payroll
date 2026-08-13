import { describe, expect, it } from 'vitest'
import { offCyclePeriod, periodOf } from '@/lib/payroll/period'

describe('período diario', () => {
  it('cubre un solo día', () => {
    const period = periodOf('2026-07-22', 'DAILY')
    expect(period.startDate).toBe('2026-07-22')
    expect(period.endDate).toBe('2026-07-22')
    expect(period.days).toHaveLength(1)
  })
})

describe('período semanal', () => {
  it('mantiene la numeración de Excel: 19–25 jul es la semana 30', () => {
    const period = periodOf('2026-07-22', 'WEEKLY')
    expect(period.startDate).toBe('2026-07-19')
    expect(period.endDate).toBe('2026-07-25')
    expect(period.periodNumber).toBe(30)
    expect(period.days).toHaveLength(7)
  })
})

describe('período catorcenal (cada 14 días)', () => {
  it('dura exactamente 14 días', () => {
    const period = periodOf('2026-01-05', 'BIWEEKLY', { biweeklyAnchor: '2026-01-01' })
    expect(period.startDate).toBe('2026-01-01')
    expect(period.endDate).toBe('2026-01-14')
    expect(period.days).toHaveLength(14)
    expect(period.periodNumber).toBe(1)
  })

  it('avanza al siguiente ciclo el día 15', () => {
    const period = periodOf('2026-01-15', 'BIWEEKLY', { biweeklyAnchor: '2026-01-01' })
    expect(period.startDate).toBe('2026-01-15')
    expect(period.endDate).toBe('2026-01-28')
    expect(period.periodNumber).toBe(2)
  })

  it('respeta el punto de arranque configurado', () => {
    const period = periodOf('2026-07-22', 'BIWEEKLY', { biweeklyAnchor: '2026-07-19' })
    expect(period.startDate).toBe('2026-07-19')
    expect(period.endDate).toBe('2026-08-01')
  })
})

describe('período quincenal (1–15 y 16–fin de mes)', () => {
  it('primera quincena', () => {
    const period = periodOf('2026-07-08', 'SEMI_MONTHLY')
    expect(period.startDate).toBe('2026-07-01')
    expect(period.endDate).toBe('2026-07-15')
    expect(period.days).toHaveLength(15)
    expect(period.label).toBe('1ª quincena de julio')
  })

  it('segunda quincena termina el último día del mes', () => {
    const period = periodOf('2026-07-20', 'SEMI_MONTHLY')
    expect(period.startDate).toBe('2026-07-16')
    expect(period.endDate).toBe('2026-07-31')
    expect(period.days).toHaveLength(16)
  })

  it('febrero de año bisiesto termina el 29', () => {
    const period = periodOf('2028-02-20', 'SEMI_MONTHLY')
    expect(period.endDate).toBe('2028-02-29')
  })

  it('febrero de año normal termina el 28', () => {
    const period = periodOf('2026-02-20', 'SEMI_MONTHLY')
    expect(period.endDate).toBe('2026-02-28')
  })

  it('numera 24 quincenas al año', () => {
    expect(periodOf('2026-01-05', 'SEMI_MONTHLY').periodNumber).toBe(1)
    expect(periodOf('2026-01-20', 'SEMI_MONTHLY').periodNumber).toBe(2)
    expect(periodOf('2026-12-20', 'SEMI_MONTHLY').periodNumber).toBe(24)
  })
})

describe('período mensual', () => {
  it('va del primero al último día del mes', () => {
    const period = periodOf('2026-07-22', 'MONTHLY')
    expect(period.startDate).toBe('2026-07-01')
    expect(period.endDate).toBe('2026-07-31')
    expect(period.days).toHaveLength(31)
    expect(period.label).toBe('Julio')
  })

  it('abril tiene 30 días', () => {
    expect(periodOf('2026-04-10', 'MONTHLY').endDate).toBe('2026-04-30')
  })
})

describe('corte fuera de calendario — cuando alguien se retira', () => {
  it('cubre exactamente el rango pedido', () => {
    const period = offCyclePeriod('2026-07-19', '2026-07-23')
    expect(period.startDate).toBe('2026-07-19')
    expect(period.endDate).toBe('2026-07-23')
    expect(period.days).toHaveLength(5)
  })

  it('permite liquidar un solo día', () => {
    const period = offCyclePeriod('2026-07-23', '2026-07-23')
    expect(period.days).toHaveLength(1)
  })

  it('se numera fuera del rango de los períodos regulares', () => {
    const period = offCyclePeriod('2026-07-19', '2026-07-23')
    expect(period.periodNumber).toBeGreaterThan(900)
  })

  it('rechaza un rango invertido', () => {
    expect(() => offCyclePeriod('2026-07-23', '2026-07-19')).toThrow(/no puede ser anterior/)
  })
})

describe('los períodos no se solapan ni dejan huecos', () => {
  it('las quincenas de un año cubren todos los días', () => {
    const covered = new Set<string>()
    for (let month = 0; month < 12; month += 1) {
      for (const day of [5, 20]) {
        const period = periodOf(
          `2026-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          'SEMI_MONTHLY',
        )
        for (const date of period.days) {
          expect(covered.has(date)).toBe(false) // ningún día en dos períodos
          covered.add(date)
        }
      }
    }
    expect(covered.size).toBe(365) // 2026 no es bisiesto
  })

  it('los meses de un año cubren todos los días', () => {
    let total = 0
    for (let month = 0; month < 12; month += 1) {
      total += periodOf(`2026-${String(month + 1).padStart(2, '0')}-10`, 'MONTHLY').days.length
    }
    expect(total).toBe(365)
  })
})
