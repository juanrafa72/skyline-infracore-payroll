import { describe, expect, it } from 'vitest'
import {
  aCsv,
  diasQuePaga,
  estadoDelDia,
  filtrarBase,
  totalizarBase,
  type BaseRow,
} from '@/lib/payroll/base'

/**
 * La base: un renglón por día, como la hoja de Excel del negocio.
 * Los totales que muestra tienen que coincidir con lo que se paga.
 */

function fila(over: Partial<BaseRow> = {}): BaseRow {
  return {
    id: 'e1',
    weekLabel: 'Semana 33',
    weekYear: 2026,
    weekStart: '2026-08-09',
    workDate: '2026-08-10',
    dayName: 'lun 10',
    workerName: 'AGUSTIN GALO',
    workerId: 'w1',
    tipo: 'PERSONA',
    dayType: 'FULL_DAY',
    detalle: null,
    payeeName: null,
    rate: '190.00',
    rateIsFrozen: true,
    amount: '190.00',
    projectName: 'DUBLIN',
    crewName: null,
    estado: 'ACTIVO',
    isControlOnly: false,
    fromImport: false,
    ...over,
  }
}

describe('cuántos días paga cada tipo', () => {
  it('un día completo paga 1', () => {
    expect(diasQuePaga('FULL_DAY')).toBe(1)
  })

  it('medio día paga medio', () => {
    expect(diasQuePaga('HALF_DAY')).toBe(0.5)
  })

  it('«Sí + extra» sigue siendo un día completo', () => {
    // El extra se paga aparte; el día no vale doble.
    expect(diasQuePaga('PLUS')).toBe(1)
  })

  it('no trabajó no paga', () => {
    expect(diasQuePaga('NO_WORK')).toBe(0)
  })
})

describe('los totales de la vista', () => {
  it('suma los días que de verdad pagan', () => {
    const t = totalizarBase([
      fila({ id: '1', dayType: 'FULL_DAY' }),
      fila({ id: '2', dayType: 'FULL_DAY' }),
      fila({ id: '3', dayType: 'HALF_DAY' }),
      fila({ id: '4', dayType: 'NO_WORK' }),
    ])
    expect(t.diasPagados).toBe('2.5')
    expect(t.diasNoTrabajo).toBe(1)
    expect(t.registros).toBe(4)
  })

  it('un día de control NO cuenta como día pagado', () => {
    // Anota, no paga (BR-243): sumarlo inflaría el conteo.
    const t = totalizarBase([
      fila({ id: '1', dayType: 'FULL_DAY' }),
      fila({ id: '2', dayType: 'FULL_DAY', isControlOnly: true }),
    ])
    expect(t.diasPagados).toBe('1')
    expect(t.registros).toBe(2)
  })

  it('cuenta personas y proyectos DISTINTOS', () => {
    const t = totalizarBase([
      fila({ id: '1', workerId: 'a', projectName: 'DUBLIN' }),
      fila({ id: '2', workerId: 'a', projectName: 'DUBLIN' }),
      fila({ id: '3', workerId: 'b', projectName: 'SELMER' }),
    ])
    expect(t.personas).toBe(2)
    expect(t.proyectos).toBe(2)
  })

  it('un día sin proyecto no inventa un proyecto', () => {
    const t = totalizarBase([fila({ projectName: null })])
    expect(t.proyectos).toBe(0)
  })

  it('días enteros se muestran sin decimal de más', () => {
    expect(totalizarBase([fila(), fila({ id: '2' })]).diasPagados).toBe('2')
  })

  it('sin filas, todo en cero', () => {
    const t = totalizarBase([])
    expect(t).toEqual({
      registros: 0,
      diasPagados: '0',
      diasNoTrabajo: 0,
      personas: 0,
      proyectos: 0,
    })
  })
})

describe('los filtros', () => {
  const filas = [
    fila({ id: '1', workerName: 'AGUSTIN GALO', projectName: 'DUBLIN', dayType: 'FULL_DAY' }),
    fila({ id: '2', workerName: 'ABDEL CARUCI', projectName: 'SELMER_TN', dayType: 'NO_WORK' }),
    fila({ id: '3', workerName: 'JUAN PEREZ', projectName: 'DUBLIN', dayType: 'HALF_DAY', crewName: 'MISSILES' }),
  ]

  it('filtra por tipo de día', () => {
    expect(filtrarBase(filas, { dayType: 'NO_WORK' }).map((f) => f.id)).toEqual(['2'])
  })

  it('busca por nombre de persona, sin importar mayúsculas', () => {
    expect(filtrarBase(filas, { q: 'agustin' }).map((f) => f.id)).toEqual(['1'])
  })

  it('busca también por proyecto', () => {
    expect(filtrarBase(filas, { q: 'dublin' }).map((f) => f.id)).toEqual(['1', '3'])
  })

  it('busca por cuadrilla', () => {
    expect(filtrarBase(filas, { q: 'missiles' }).map((f) => f.id)).toEqual(['3'])
  })

  it('sin filtros devuelve todo', () => {
    expect(filtrarBase(filas, {})).toHaveLength(3)
  })

  it('una búsqueda que no encuentra nada devuelve vacío, no todo', () => {
    expect(filtrarBase(filas, { q: 'zzzz' })).toHaveLength(0)
  })
})

describe('bajar a Excel', () => {
  it('lleva cabecera y una línea por día', () => {
    const csv = aCsv([fila(), fila({ id: '2', workerName: 'JUAN' })])
    const lineas = csv.split('\n')
    expect(lineas).toHaveLength(3)
    // Se llama «Nombre», no «Trabajador»: la hoja lleva equipos y cuadrillas.
    expect(lineas[0]).toContain('Nombre')
  })

  it('un nombre con coma NO parte la fila', () => {
    // «ANGELA MARTINEZ ( DON PEDRO)» y similares existen en los datos.
    const csv = aCsv([fila({ workerName: 'MARTINEZ, ANGELA' })])
    const linea = csv.split('\n')[1]!
    expect(linea).toContain('"MARTINEZ, ANGELA"')
    expect(csv.split('\n')).toHaveLength(2)
  })

  it('una comilla dentro del nombre se escapa', () => {
    const csv = aCsv([fila({ workerName: 'EL "CHATO"' })])
    expect(csv).toContain('"EL ""CHATO"""')
  })

  it('dice de dónde salió cada día', () => {
    const csv = aCsv([
      fila({ id: '1' }),
      fila({ id: '2', fromImport: true }),
      fila({ id: '3', isControlOnly: true }),
    ])
    expect(csv).toContain('"Capturado"')
    expect(csv).toContain('"Excel"')
    expect(csv).toContain('"Control"')
  })

  it('un día sin calcular deja la tarifa vacía, no en cero', () => {
    // Poner 0 haría creer que se le pagó cero.
    const csv = aCsv([fila({ rate: null, amount: null })])
    expect(csv.split('\n')[1]).toContain('"",""')
  })
})

describe('en qué va cada día', () => {
  it('marcado pero sin calcular: activo', () => {
    expect(estadoDelDia(null, false)).toBe('ACTIVO')
  })

  it('calculada pero todavía sin enviar: sigue activo', () => {
    // Está en la mesa de quien prepara: nadie más la está esperando.
    expect(estadoDelDia('PREPARED', false)).toBe('ACTIVO')
    expect(estadoDelDia('DRAFT', false)).toBe('ACTIVO')
  })

  it('enviada: pendiente por aprobación', () => {
    expect(estadoDelDia('PENDING_APPROVAL', false)).toBe('PDT_APROBACION')
  })

  it('aprobada: pendiente por pago', () => {
    expect(estadoDelDia('APPROVED', false)).toBe('PDT_PAGO')
    expect(estadoDelDia('READY_TO_PAY', false)).toBe('PDT_PAGO')
    expect(estadoDelDia('PAYMENT_IN_PROCESS', false)).toBe('PDT_PAGO')
  })

  it('el dinero ya salió: pagada', () => {
    expect(estadoDelDia('PAID', false)).toBe('PAGADA')
    expect(estadoDelDia('RECONCILED', false)).toBe('PAGADA')
    expect(estadoDelDia('CLOSED', false)).toBe('PAGADA')
  })

  it('devuelta con comentarios se distingue de las que esperan', () => {
    // Hay que corregirla; no está esperando a nadie.
    expect(estadoDelDia('REJECTED', false)).toBe('DEVUELTA')
  })

  it('un día del Excel es ARCHIVO, aunque tenga estado', () => {
    // Ya se pagó por fuera (BR-153): decir «activo» invitaría a calcularlo.
    expect(estadoDelDia(null, true)).toBe('ARCHIVO')
    expect(estadoDelDia('PAID', true)).toBe('ARCHIVO')
  })
})

describe('filtrar por estado', () => {
  const filas = [
    fila({ id: '1', estado: 'ACTIVO' }),
    fila({ id: '2', estado: 'PDT_APROBACION' }),
    fila({ id: '3', estado: 'PDT_PAGO' }),
    fila({ id: '4', estado: 'PAGADA' }),
  ]

  it('deja solo las de ese estado', () => {
    expect(filtrarBase(filas, { estado: 'PDT_PAGO' }).map((f) => f.id)).toEqual(['3'])
  })

  it('sin filtro de estado devuelve todas', () => {
    expect(filtrarBase(filas, {})).toHaveLength(4)
  })

  it('el estado se combina con los otros filtros', () => {
    const mezcla = [
      fila({ id: 'a', estado: 'PAGADA', workerName: 'JUAN' }),
      fila({ id: 'b', estado: 'PAGADA', workerName: 'PEDRO' }),
    ]
    expect(filtrarBase(mezcla, { estado: 'PAGADA', q: 'juan' }).map((f) => f.id)).toEqual(['a'])
  })
})

describe('el estado en el archivo de Excel', () => {
  it('sale escrito en palabras, no en código', () => {
    const csv = aCsv([fila({ estado: 'PDT_PAGO' })])
    expect(csv).toContain('"Pdt. por pago"')
    expect(csv).not.toContain('PDT_PAGO')
  })

  it('la columna se llama «Vale el día», no «Se pagó»', () => {
    // «Se pagó» hacía creer que el dinero ya salió del banco.
    const csv = aCsv([fila()])
    expect(csv.split('\n')[0]).toContain('"Vale el día"')
    expect(csv.split('\n')[0]).toContain('"Estado"')
  })
})

describe('la hoja lleva TODO, no solo personas', () => {
  const mezcla = [
    fila({ id: 'p', tipo: 'PERSONA', workerName: 'AGUSTIN GALO', workDate: '2026-08-14' }),
    fila({
      id: 'e',
      tipo: 'EQUIPO',
      workerName: 'PLOW RENTADO',
      dayType: 'EN_OBRA',
      detalle: 'rentado',
      payeeName: 'ALQUILERES DEL SUR',
      workDate: '2026-08-14',
    }),
    fila({
      id: 'c',
      tipo: 'CUADRILLA',
      workerName: 'CUADRILLA HUGO',
      dayType: 'PRODUCCION',
      detalle: '10,000 pies',
      payeeName: 'Hugo',
      workDate: '2026-08-14',
    }),
  ]

  it('filtra por tipo: solo equipos', () => {
    expect(filtrarBase(mezcla, { tipo: 'EQUIPO' }).map((f) => f.id)).toEqual(['e'])
  })

  it('sin filtro de tipo salen los tres', () => {
    expect(filtrarBase(mezcla, {})).toHaveLength(3)
  })

  it('la búsqueda encuentra por el beneficiario', () => {
    // «¿a quién le pagamos el alquiler?» es una pregunta real.
    expect(filtrarBase(mezcla, { q: 'alquileres' }).map((f) => f.id)).toEqual(['e'])
    expect(filtrarBase(mezcla, { q: 'hugo' }).map((f) => f.id)).toEqual(['c'])
  })

  it('el tipo y el beneficiario van al Excel', () => {
    const csv = aCsv(mezcla)
    expect(csv.split('\n')[0]).toContain('"Qué"')
    expect(csv.split('\n')[0]).toContain('"Se le paga a"')
    expect(csv).toContain('"Equipo"')
    expect(csv).toContain('"Cuadrilla"')
    expect(csv).toContain('"ALQUILERES DEL SUR"')
  })

  it('el detalle de la cuadrilla dice cuánto produjo', () => {
    expect(aCsv(mezcla)).toContain('"10,000 pies"')
  })

  it('el tipo se lee en palabras, no en código', () => {
    const csv = aCsv([fila({ tipo: 'EQUIPO' })])
    expect(csv).toContain('"Equipo"')
    expect(csv).not.toMatch(/"EQUIPO"/)
  })
})
