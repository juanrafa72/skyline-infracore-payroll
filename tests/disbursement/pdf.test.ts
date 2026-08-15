/**
 * El desprendible que va a contabilidad.
 *
 * Lo que se prueba no es que "se vea bonito", sino que el archivo sea un PDF
 * válido y que contenga el detalle completo. Un soporte contable al que le
 * falte un trabajador o un monto no sirve para nada.
 */
import { describe, expect, it } from 'vitest'
import { renderDisbursementPdf, type DisbursementPdfData } from '@/lib/pdf/disbursement'
import { PdfDocument, ellipsize, textWidth } from '@/lib/pdf/writer'

function data(overrides: Partial<DisbursementPdfData> = {}): DisbursementPdfData {
  return {
    orderNumber: 'OD-TEST-2026-0001',
    status: 'Pendiente de pago',
    companyName: 'Compañía de prueba',
    recipientName: 'Receptora de prueba',
    recipientTaxId: '00-0000000',
    weekLabel: 'Semana de prueba',
    periodStart: '2026-03-01',
    periodEnd: '2026-03-07',
    createdAt: '2026-03-08',
    workers: [
      { name: 'Primera Persona', amount: '450.00', paid: false, group: null },
      { name: 'Segunda Persona', amount: '312.50', paid: false, group: null },
    ],
    total: '762.50',
    amountPaid: '0.00',
    preparedBy: 'Quien prepara',
    approvedBy: 'Quien aprueba',
    approvedAt: '2026-03-08',
    paidBy: null,
    paidAt: null,
    paymentDate: null,
    method: null,
    bankName: null,
    reference: null,
    notes: null,
    differenceReason: null,
    cancellationReason: null,
    ...overrides,
  }
}

/** El texto de un PDF sin comprimir se puede leer directo de los bytes. */
function readable(pdf: Buffer): string {
  return pdf.toString('latin1')
}

describe('desprendible de la orden de desembolso', () => {
  it('sale un PDF válido', () => {
    const pdf = renderDisbursementPdf(data())
    const text = readable(pdf)

    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(text).toContain('/Type /Catalog')
    expect(text).toContain('startxref')
  })

  it('trae el consecutivo, la receptora, la compañía y la semana', () => {
    const pdf = readable(renderDisbursementPdf(data()))

    expect(pdf).toContain('OD-TEST-2026-0001')
    expect(pdf).toContain('Receptora de prueba')
    expect(pdf).toContain('Semana de prueba')
    expect(pdf).toContain('ORDEN DE DESEMBOLSO')
  })

  it('trae a CADA trabajador con su monto — no solo el total', () => {
    const pdf = readable(renderDisbursementPdf(data()))

    expect(pdf).toContain('Primera Persona')
    expect(pdf).toContain('450.00')
    expect(pdf).toContain('Segunda Persona')
    expect(pdf).toContain('312.50')
    expect(pdf).toContain('TOTAL A TRANSFERIR')
    expect(pdf).toContain('762.50')
  })

  it('los montos del detalle suman el total impreso', () => {
    const rows = data().workers
    const sum = rows.reduce((total, worker) => total + Math.round(Number(worker.amount) * 100), 0)
    expect((sum / 100).toFixed(2)).toBe(data().total)
  })

  it('deja la trazabilidad completa cuando ya se pagó', () => {
    const pdf = readable(
      renderDisbursementPdf(
        data({
          status: 'Pagada',
          amountPaid: '762.50',
          paidBy: 'Quien paga',
          paidAt: '2026-03-10',
          paymentDate: '2026-03-10',
          method: 'Transferencia',
          bankName: 'Banco de prueba',
          reference: 'REF-XYZ-123',
          workers: [
            { name: 'Primera Persona', amount: '450.00', paid: true, group: null },
            { name: 'Segunda Persona', amount: '312.50', paid: true, group: null },
          ],
        }),
      ),
    )

    expect(pdf).toContain('Quien prepara')
    expect(pdf).toContain('Quien aprueba')
    expect(pdf).toContain('Quien paga')
    expect(pdf).toContain('REF-XYZ-123')
    expect(pdf).toContain('Banco de prueba')
  })

  it('desglosa por cuadrilla con subtítulos y subtotales — pedido del negocio', () => {
    const pdf = readable(
      renderDisbursementPdf(
        data({
          workers: [
            { name: 'Ana Norte', amount: '200.00', paid: false, group: 'Cuadrilla Norte' },
            { name: 'Beto Norte', amount: '300.00', paid: false, group: 'Cuadrilla Norte' },
            { name: 'Carla Suelta', amount: '150.00', paid: false, group: null },
          ],
          total: '650.00',
        }),
      ),
    )

    expect(pdf).toContain('CUADRILLA NORTE')
    expect(pdf).toContain('SIN CUADRILLA')
    expect(pdf).toContain('subtotal')
    // El subtotal de la cuadrilla: 200 + 300, en centavos exactos.
    expect(pdf).toContain('$500.00')
    // Todos los renglones siguen presentes.
    expect(pdf).toContain('Ana Norte')
    expect(pdf).toContain('Carla Suelta')
  })

  it('sin cuadrillas, la lista sale plana como siempre', () => {
    const pdf = readable(
      renderDisbursementPdf(
        data({
          workers: [
            { name: 'Primera Persona', amount: '450.00', paid: false, group: null },
            { name: 'Segunda Persona', amount: '312.50', paid: false, group: null },
          ],
        }),
      ),
    )

    expect(pdf).not.toContain('SIN CUADRILLA')
    expect(pdf).not.toContain('subtotal')
  })

  it('los acentos y la ñ no se rompen', () => {
    const pdf = readable(
      renderDisbursementPdf(
        data({
          recipientName: 'Muñoz Construcción S.A.',
          workers: [{ name: 'José Ramírez Peña', amount: '762.50', paid: false, group: null }],
        }),
      ),
    )

    expect(pdf).toContain('Muñoz Construcción')
    expect(pdf).toContain('José Ramírez Peña')
  })

  it('los paréntesis en un nombre no rompen el archivo', () => {
    const pdf = renderDisbursementPdf(
      data({ workers: [{ name: 'Empresa (antes Otra) \\ SAS', amount: '762.50', paid: false, group: null }] }),
    )
    const text = readable(pdf)

    expect(text).toContain('Empresa \\(antes Otra\\) \\\\ SAS')
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('una lista larga se reparte en varias páginas sin perder a nadie', () => {
    const workers = Array.from({ length: 90 }, (_, index) => ({
      name: `Persona numero ${index + 1}`,
      amount: '100.00',
      paid: false,
      group: null,
    }))
    const pdf = readable(renderDisbursementPdf(data({ workers, total: '9000.00' })))

    const pages = Number(/\/Count (\d+)/.exec(pdf)?.[1] ?? 0)
    expect(pages).toBeGreaterThan(1)

    // Lo que importa no es cuántas páginas, sino que estén TODOS.
    for (const worker of workers) {
      expect(pdf).toContain(worker.name)
    }
    expect(pdf).toContain('continuaci')
    expect(pdf).toContain('9,000.00')
  })

  it('el motivo de una diferencia queda impreso', () => {
    const pdf = readable(
      renderDisbursementPdf(
        data({ amountPaid: '450.00', differenceReason: 'El giro cubrio solo a la primera' }),
      ),
    )
    expect(pdf).toContain('El giro cubrio solo a la primera')
  })
})

describe('el generador de PDF', () => {
  it('mide el texto para poder alinear los montos a la derecha', () => {
    expect(textWidth('', 10)).toBe(0)
    expect(textWidth('MMM', 10)).toBeGreaterThan(textWidth('iii', 10))
    // Una letra con tilde mide lo mismo que su base: si no, la columna se corre.
    expect(textWidth('é', 10)).toBeCloseTo(textWidth('e', 10), 5)
  })

  it('recorta lo que no cabe sin usar caracteres fuera de Latin-1', () => {
    const cut = ellipsize('Un nombre bastante largo que no cabe', 60, 10)
    expect(cut.endsWith('...')).toBe(true)
    expect(textWidth(cut, 10)).toBeLessThanOrEqual(60)
    expect(cut).not.toContain('…')
  })

  it('no emite una página en blanco si se pidió uno de más', () => {
    const document = new PdfDocument()
    document.text(50, 50, 'única página')
    document.newPage()
    expect(readable(document.build())).toContain('/Count 1')
  })
})
