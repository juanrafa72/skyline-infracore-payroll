import { describe, expect, it } from 'vitest'
import {
  resumirHistorico,
  totalesPorReceptora,
  type PagoHistorico,
} from '@/lib/disbursement/history'

/**
 * Los totales del histórico de pagos: qué salió, qué falta, y a quién.
 * Sumar mal aquí significa reportarle al negocio una cifra que no es.
 */

function orden(over: Partial<PagoHistorico> = {}): PagoHistorico {
  return {
    orderId: 'o1',
    orderNumber: 'SKY-2026-0001',
    recipientName: 'FORZO',
    recipientTaxId: '88-1000001',
    weekLabel: 'Semana 33',
    periodStart: '2026-08-09',
    periodEnd: '2026-08-15',
    status: 'PAID',
    totalAmount: '1000.00',
    amountPaid: '1000.00',
    paymentDate: '2026-08-18',
    method: 'ACH',
    bankName: 'Chase',
    reference: 'TRX-1',
    paidByName: 'Tesorería',
    approvedByName: 'Rafael',
    itemCount: 1,
    items: [
      { id: 'i1', name: 'Juan', crewLabel: null, detail: '5 días', amount: '1000.00', kind: 'WORKER' },
    ],
    ...over,
  }
}

describe('lo que ya salió y lo que falta', () => {
  it('suma lo pagado de todas las órdenes', () => {
    const r = resumirHistorico([
      orden({ amountPaid: '1000.00' }),
      orden({ orderId: 'o2', amountPaid: '2500.50' }),
    ])
    expect(r.pagado).toBe('3500.50')
    expect(r.ordenesPagadas).toBe(2)
  })

  it('lo pendiente es lo que FALTA, no el total de la orden', () => {
    // Una orden pagada a medias ya movió parte del dinero.
    const r = resumirHistorico([
      orden({ status: 'PARTIALLY_PAID', totalAmount: '1000.00', amountPaid: '400.00' }),
    ])
    expect(r.pagado).toBe('400.00')
    expect(r.pendiente).toBe('600.00')
    expect(r.ordenesPendientes).toBe(1)
  })

  it('una orden anulada no cuenta como pendiente: ya no va a salir', () => {
    const r = resumirHistorico([
      orden({ status: 'CANCELLED', totalAmount: '900.00', amountPaid: '0.00' }),
    ])
    expect(r.pendiente).toBe('0.00')
    expect(r.ordenesPendientes).toBe(0)
  })

  it('una orden sin pagar cuenta entera como pendiente', () => {
    const r = resumirHistorico([
      orden({ status: 'PENDING_PAYMENT', totalAmount: '750.00', amountPaid: '0.00' }),
    ])
    expect(r.pendiente).toBe('750.00')
    expect(r.pagado).toBe('0.00')
  })
})

describe('en qué se fue la plata', () => {
  it('separa personas, cuadrillas y equipos', () => {
    const r = resumirHistorico([
      orden({
        items: [
          { id: 'a', name: 'Juan', crewLabel: null, detail: '5 días', amount: '650.00', kind: 'WORKER' },
          { id: 'b', name: 'Hugo', crewLabel: 'MISSILES', detail: '10.000 pies', amount: '5000.00', kind: 'CREW' },
          { id: 'c', name: 'PLOW', crewLabel: null, detail: '4 días × $450', amount: '1800.00', kind: 'EQUIPMENT' },
        ],
      }),
    ])
    expect(r.porTipo.personas).toBe('650.00')
    expect(r.porTipo.cuadrillas).toBe('5000.00')
    expect(r.porTipo.equipos).toBe('1800.00')
  })

  it('suma en centavos: los decimales no se pierden', () => {
    const r = resumirHistorico([
      orden({ amountPaid: '0.10' }),
      orden({ orderId: 'o2', amountPaid: '0.20' }),
    ])
    // 0.1 + 0.2 en coma flotante da 0.30000000000000004.
    expect(r.pagado).toBe('0.30')
  })
})

describe('a quién se le ha pagado', () => {
  it('junta las órdenes de la misma empresa', () => {
    const filas = [
      orden({ recipientName: 'FORZO', amountPaid: '1000.00' }),
      orden({ orderId: 'o2', recipientName: 'QUINTERO', amountPaid: '500.00' }),
      orden({ orderId: 'o3', recipientName: 'FORZO', amountPaid: '250.00' }),
    ]
    const totales = totalesPorReceptora(filas)
    expect(totales).toHaveLength(2)
    const forzo = totales.find((t) => t.name === 'FORZO')!
    expect(forzo.pagado).toBe('1250.00')
    expect(forzo.ordenes).toBe(2)
  })

  it('la que más pesa va de primera', () => {
    const totales = totalesPorReceptora([
      orden({ recipientName: 'CHICA', amountPaid: '100.00' }),
      orden({ orderId: 'o2', recipientName: 'GRANDE', amountPaid: '9000.00' }),
    ])
    expect(totales[0]!.name).toBe('GRANDE')
  })

  it('lleva también lo que le falta por cobrar', () => {
    const totales = totalesPorReceptora([
      orden({ status: 'PARTIALLY_PAID', totalAmount: '1000.00', amountPaid: '300.00' }),
    ])
    expect(totales[0]!.pagado).toBe('300.00')
    expect(totales[0]!.pendiente).toBe('700.00')
  })

  it('cuenta cuántas empresas distintas recibieron dinero', () => {
    const r = resumirHistorico([
      orden({ recipientName: 'A' }),
      orden({ orderId: 'o2', recipientName: 'B' }),
      orden({ orderId: 'o3', recipientName: 'A' }),
    ])
    expect(r.receptoras).toBe(2)
  })
})

describe('sin datos', () => {
  it('un histórico vacío no revienta ni inventa cifras', () => {
    const r = resumirHistorico([])
    expect(r.pagado).toBe('0.00')
    expect(r.pendiente).toBe('0.00')
    expect(r.receptoras).toBe(0)
    expect(totalesPorReceptora([])).toEqual([])
  })
})
