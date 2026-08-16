import { describe, expect, it } from 'vitest'
import {
  asuntoDe,
  correoValido,
  cuerpoDe,
  destinatariosDe,
  sinRepetidos,
  formatReportNumber,
  type DestinatarioConfigurado,
} from '@/lib/mail/reports'


/**
 * Quién recibe cada reporte. Mandarle a un contratista el desprendible de otro
 * expone lo que se le paga a un tercero: es el error que estas pruebas cuidan.
 */

const base = (over: Partial<DestinatarioConfigurado> = {}): DestinatarioConfigurado => ({
  id: '1',
  name: 'Auxiliar contable',
  email: 'contabilidad@skyline.com',
  kinds: [],
  paymentRecipientId: null,
  bcc: false,
  active: true,
  ...over,
})

describe('a quién le llega cada reporte', () => {
  it('la auxiliar contable recibe todo', () => {
    const r = destinatariosDe([base()], { kind: 'DISBURSEMENT_PDF', paymentRecipientId: 'forzo' })
    expect(r).toHaveLength(1)
  })

  it('un destinatario atado a FORZO NO recibe el desprendible de Quintero', () => {
    // El error caro: exponerle a un contratista lo que se le paga a otro.
    const forzo = base({ id: '2', name: 'FORZO', email: 'pagos@forzo.com', paymentRecipientId: 'forzo' })
    const r = destinatariosDe([forzo], {
      kind: 'DISBURSEMENT_PDF',
      paymentRecipientId: 'quintero',
    })
    expect(r).toHaveLength(0)
  })

  it('pero sí recibe la SUYA', () => {
    const forzo = base({ id: '2', email: 'pagos@forzo.com', paymentRecipientId: 'forzo' })
    const r = destinatariosDe([forzo], { kind: 'DISBURSEMENT_PDF', paymentRecipientId: 'forzo' })
    expect(r).toHaveLength(1)
  })

  it('quien solo pidió resúmenes no recibe desprendibles', () => {
    const soloResumen = base({ kinds: ['WEEKLY_SUMMARY'] })
    expect(destinatariosDe([soloResumen], { kind: 'DISBURSEMENT_PDF' })).toHaveLength(0)
    expect(destinatariosDe([soloResumen], { kind: 'WEEKLY_SUMMARY' })).toHaveLength(1)
  })

  it('un destinatario desactivado no recibe nada', () => {
    expect(destinatariosDe([base({ active: false })], { kind: 'DISBURSEMENT_PDF' })).toHaveLength(0)
  })

  it('el caso completo del negocio: contable + la receptora de esa orden', () => {
    const todos = [
      base({ id: '1', name: 'Auxiliar contable', email: 'conta@skyline.com', bcc: true }),
      base({ id: '2', name: 'FORZO', email: 'pagos@forzo.com', paymentRecipientId: 'forzo' }),
      base({ id: '3', name: 'QUINTERO', email: 'pagos@quintero.com', paymentRecipientId: 'quintero' }),
    ]
    const r = destinatariosDe(todos, { kind: 'DISBURSEMENT_PDF', paymentRecipientId: 'forzo' })
    expect(r.map((d) => d.email)).toEqual(['conta@skyline.com', 'pagos@forzo.com'])
  })
})

describe('sin correos repetidos', () => {
  it('si alguien está dos veces, le llega una sola', () => {
    const r = sinRepetidos([
      base({ id: '1', email: 'conta@skyline.com' }),
      base({ id: '2', email: 'CONTA@Skyline.com' }),
    ])
    expect(r).toHaveLength(1)
  })

  it('no se come a los distintos', () => {
    expect(
      sinRepetidos([base({ id: '1', email: 'a@x.com' }), base({ id: '2', email: 'b@x.com' })]),
    ).toHaveLength(2)
  })
})

describe('correos válidos', () => {
  it('acepta los normales', () => {
    expect(correoValido('rafael@skylinenext.com')).toBe(true)
    expect(correoValido('a.b-c@sub.dominio.co')).toBe(true)
  })

  it('rechaza lo que no llegaría a ninguna parte', () => {
    expect(correoValido('sin-arroba')).toBe(false)
    expect(correoValido('sin@dominio')).toBe(false)
    expect(correoValido('con espacio@x.com')).toBe(false)
    expect(correoValido('')).toBe(false)
  })
})

describe('el consecutivo y el asunto', () => {
  it('el número lleva compañía y año, para reconocerlo fuera del sistema', () => {
    expect(formatReportNumber('SKYLINE', 2026, 12)).toBe('RP-SKYLINE-2026-0012')
    expect(formatReportNumber('INFRACORE', 2026, 1)).toBe('RP-INFRACORE-2026-0001')
  })

  it('el asunto arranca con el consecutivo, para poder ordenar por asunto', () => {
    const asunto = asuntoDe({
      reportNumber: 'RP-SKYLINE-2026-0012',
      kind: 'DISBURSEMENT_PDF',
      companyName: 'Skyline Advance Tech',
      orderNumber: 'OD-SKYLINE-2026-0007',
      weekLabel: 'Semana 33 · 2026',
    })
    expect(asunto.startsWith('RP-SKYLINE-2026-0012')).toBe(true)
    expect(asunto).toContain('OD-SKYLINE-2026-0007')
  })

  it('el cuerpo dice lo esencial y remite al adjunto', () => {
    const cuerpo = cuerpoDe({
      reportNumber: 'RP-SKYLINE-2026-0012',
      companyName: 'Skyline Advance Tech',
      orderNumber: 'OD-SKYLINE-2026-0007',
      recipientName: 'FORZO',
      total: '5,000.00',
    })
    expect(cuerpo).toContain('RP-SKYLINE-2026-0012')
    expect(cuerpo).toContain('FORZO')
    expect(cuerpo).toContain('adjunto')
    expect(cuerpo).toContain('No responder')
  })
})
