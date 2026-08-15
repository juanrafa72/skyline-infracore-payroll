import { PdfDocument, ellipsize } from './writer'
import { type Cents, ZERO, add, toCents, toDecimalString } from '@/lib/payroll/engine/money'

/**
 * Desprendible de una orden de desembolso.
 *
 * Lo lee alguien de contabilidad que no estuvo en la nómina y tiene que
 * entender, sin preguntarle a nadie, por qué salió ese dinero: cuánto, a quién
 * se le transfirió, por qué trabajadores, de qué semana y de qué compañía.
 *
 * El detalle por persona NO es opcional. Un documento que solo diga
 * «empresa receptora + total» no sirve para soportar el movimiento.
 */

export interface DisbursementPdfData {
  orderNumber: string
  status: string
  companyName: string
  recipientName: string
  recipientTaxId: string | null
  weekLabel: string
  periodStart: string
  periodEnd: string
  createdAt: string
  /**
   * Renglones del desembolso. `group` es la cuadrilla congelada al generar la
   * orden (null = sin cuadrilla); alimenta el desglose que pidió el negocio.
   * `detail` es contra QUÉ se paga ese renglón —«5 días», «3 registros de
   * producción», «4 días × $450.00»—, también congelado: sin él, contabilidad
   * ve un monto sin saber a cuánto trabajo corresponde (BR-195). `null` en las
   * órdenes emitidas antes de que existiera.
   */
  workers: ReadonlyArray<{
    name: string
    detail: string | null
    amount: string
    paid: boolean
    group: string | null
  }>
  total: string
  amountPaid: string
  preparedBy: string | null
  approvedBy: string | null
  approvedAt: string | null
  paidBy: string | null
  paidAt: string | null
  paymentDate: string | null
  method: string | null
  bankName: string | null
  reference: string | null
  notes: string | null
  differenceReason: string | null
  cancellationReason: string | null
}

const MARGIN = 48
const RIGHT = 612 - MARGIN

function currency(value: string): string {
  return `$${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function renderDisbursementPdf(data: DisbursementPdfData): Buffer {
  const pdf = new PdfDocument()
  let y = MARGIN

  // ── Encabezado ──────────────────────────────────────────────
  pdf.text(MARGIN, y + 4, 'ORDEN DE DESEMBOLSO', { size: 17, bold: true })
  pdf.text(RIGHT, y + 4, data.orderNumber, { size: 13, bold: true, align: 'right' })
  y += 20
  pdf.text(MARGIN, y, data.companyName, { size: 10, gray: 0.35 })
  pdf.text(RIGHT, y, data.status, { size: 9, align: 'right', gray: 0.35 })
  y += 12
  pdf.line(MARGIN, y, RIGHT, y, 0.15, 1.2)
  y += 22

  // ── A quién se le transfiere ────────────────────────────────
  pdf.text(MARGIN, y, 'SE LE TRANSFIERE A', { size: 8, bold: true, gray: 0.45 })
  y += 15
  pdf.text(MARGIN, y, data.recipientName, { size: 15, bold: true })
  pdf.text(RIGHT, y, currency(data.total), { size: 17, bold: true, align: 'right' })
  y += 14
  if (data.recipientTaxId) {
    pdf.text(MARGIN, y, `Tax ID / EIN: ${data.recipientTaxId}`, { size: 9, gray: 0.4 })
  }
  pdf.text(RIGHT, y, `${data.workers.length} renglón(es)`, { size: 9, align: 'right', gray: 0.4 })
  y += 22

  // ── Datos del movimiento ────────────────────────────────────
  pdf.rect(MARGIN, y - 4, RIGHT - MARGIN, 46, 0.96)
  const columns = [
    { label: 'Nómina de', value: data.companyName },
    { label: 'Semana / período', value: data.weekLabel },
    { label: 'Fechas', value: `${data.periodStart} a ${data.periodEnd}` },
    { label: 'Emitida', value: data.createdAt },
  ]
  const columnWidth = (RIGHT - MARGIN) / columns.length
  columns.forEach((column, index) => {
    const x = MARGIN + 10 + index * columnWidth
    pdf.text(x, y + 9, column.label.toUpperCase(), { size: 7, bold: true, gray: 0.5 })
    pdf.text(x, y + 23, ellipsize(column.value, columnWidth - 16, 9.5), { size: 9.5 })
  })
  y += 62

  // ── Detalle por cuadrilla y concepto ────────────────────────
  // El desglose por crew fue pedido expreso del negocio: contabilidad tiene
  // que ver de qué cuadrilla salió cada renglón, no solo la lista plana.
  pdf.text(MARGIN, y, 'DETALLE DEL DESEMBOLSO — POR CUADRILLA Y CONCEPTO', {
    size: 8,
    bold: true,
    gray: 0.45,
  })
  y += 14

  /*
   * Encabezado de columnas.
   *
   * Sin él, la columna del medio («5 días», «3 registros de producción») se lee
   * como un comentario suelto. Con él, contabilidad sabe qué está mirando.
   */
  const DETAIL_X = MARGIN + 286
  pdf.text(MARGIN + 24, y, 'CONCEPTO', { size: 7, bold: true, gray: 0.5 })
  pdf.text(DETAIL_X, y, 'CONTRA QUÉ', { size: 7, bold: true, gray: 0.5 })
  pdf.text(RIGHT, y, 'MONTO', { size: 7, bold: true, gray: 0.5, align: 'right' })
  y += 10
  pdf.line(MARGIN, y, RIGHT, y, 0.75)
  y += 14

  const anyPaid = data.workers.some((worker) => worker.paid)

  const sorted = [...data.workers].sort((a, b) => {
    const ga = a.group ?? '￿' // sin cuadrilla al final
    const gb = b.group ?? '￿'
    if (ga !== gb) return ga.localeCompare(gb, 'es')
    return a.name.localeCompare(b.name, 'es')
  })
  const groupCount = new Set(sorted.map((worker) => worker.group ?? '')).size
  const showGroups = groupCount > 1 || sorted.some((worker) => worker.group !== null)

  const breakIfNeeded = () => {
    // Salto de página con el encabezado repetido: una lista larga tiene que
    // seguir leyéndose igual en la hoja 2.
    if (y > 720) {
      pdf.text(MARGIN, 760, `${data.orderNumber} · continuación`, { size: 8, gray: 0.5 })
      pdf.newPage()
      y = MARGIN
      pdf.text(MARGIN, y, `${data.orderNumber} — ${data.recipientName}`, { size: 10, bold: true })
      y += 18
      pdf.line(MARGIN, y, RIGHT, y, 0.75)
      y += 14
    }
  }

  let currentGroup: string | null | undefined
  let groupSubtotal: Cents = ZERO
  const flushSubtotal = () => {
    if (!showGroups || currentGroup === undefined) return
    breakIfNeeded()
    pdf.text(RIGHT - 110, y, 'subtotal', { size: 8, align: 'right', gray: 0.5 })
    pdf.text(RIGHT, y, currency(toDecimalString(groupSubtotal)), {
      size: 9,
      bold: true,
      align: 'right',
    })
    y += 14
    groupSubtotal = ZERO
  }

  sorted.forEach((worker, index) => {
    if (showGroups && worker.group !== currentGroup) {
      flushSubtotal()
      currentGroup = worker.group
      breakIfNeeded()
      pdf.text(MARGIN, y, ellipsize((worker.group ?? 'Sin cuadrilla').toUpperCase(), 400, 8.5), {
        size: 8.5,
        bold: true,
        gray: 0.35,
      })
      y += 13
    }

    breakIfNeeded()
    pdf.text(MARGIN + 2, y, String(index + 1).padStart(2, '0'), { size: 8, gray: 0.55 })
    pdf.text(MARGIN + 24, y, ellipsize(worker.name, 254, 10), { size: 10 })
    if (worker.detail) {
      // Contra qué se paga: los días de la persona, la producción de la
      // cuadrilla, el alquiler del equipo. Un monto solo no explica nada.
      pdf.text(DETAIL_X, y, ellipsize(worker.detail, anyPaid ? 108 : 168, 9), {
        size: 9,
        gray: 0.4,
      })
    }
    if (anyPaid) {
      pdf.text(RIGHT - 96, y, worker.paid ? 'pagado' : 'pendiente', {
        size: 8,
        align: 'right',
        gray: 0.5,
      })
    }
    pdf.text(RIGHT, y, currency(worker.amount), { size: 10, align: 'right' })
    groupSubtotal = add(groupSubtotal, toCents(worker.amount))
    y += 15
    pdf.line(MARGIN, y - 5, RIGHT, y - 5, 0.92)
  })
  flushSubtotal()

  y += 4
  pdf.line(MARGIN, y, RIGHT, y, 0.15, 1.2)
  y += 18
  pdf.text(MARGIN, y, 'TOTAL A TRANSFERIR', { size: 11, bold: true })
  pdf.text(RIGHT, y, currency(data.total), { size: 15, bold: true, align: 'right' })
  y += 18

  if (data.amountPaid !== data.total) {
    pdf.text(MARGIN, y, 'Transferido hasta ahora', { size: 9, gray: 0.4 })
    pdf.text(RIGHT, y, currency(data.amountPaid), { size: 10, align: 'right', gray: 0.4 })
    y += 16
  }

  // ── Quién hizo cada cosa ────────────────────────────────────
  // Si ya no cabe, se pasa a otra hoja: la trazabilidad no se recorta.
  if (y > 610) {
    pdf.newPage()
    y = MARGIN
    pdf.text(MARGIN, y, `${data.orderNumber} — ${data.recipientName}`, { size: 10, bold: true })
    y += 22
  }

  y += 12
  pdf.line(MARGIN, y, RIGHT, y, 0.85)
  y += 16
  pdf.text(MARGIN, y, 'TRAZABILIDAD', { size: 8, bold: true, gray: 0.45 })
  y += 16

  const trail: Array<[string, string]> = [
    ['Preparó la nómina', data.preparedBy ?? '—'],
    ['Aprobó', `${data.approvedBy ?? '—'}${data.approvedAt ? ` · ${data.approvedAt}` : ''}`],
    ['Pagó', data.paidBy ? `${data.paidBy}${data.paidAt ? ` · ${data.paidAt}` : ''}` : 'sin pagar'],
    ['Fecha de pago', data.paymentDate ?? '—'],
    ['Método', data.method ?? '—'],
    ['Banco / plataforma', data.bankName ?? '—'],
    ['Referencia bancaria', data.reference ?? '—'],
    ['Estado', data.status],
  ]

  /*
   * La etiqueta va ENCIMA del valor, no al lado.
   *
   * Al lado, un nombre con fecha no cabía en media hoja y salía recortado —
   * y en un soporte contable, «Persona que aprueba · 2026-0...» no sirve.
   */
  const half = (RIGHT - MARGIN) / 2
  const trailTop = y
  trail.forEach(([label, value], index) => {
    const x = MARGIN + (index % 2) * half
    const rowY = trailTop + Math.floor(index / 2) * 30
    pdf.text(x, rowY, label.toUpperCase(), { size: 7, bold: true, gray: 0.5 })
    pdf.text(x, rowY + 12, ellipsize(value, half - 14, 9.5), { size: 9.5 })
  })
  y = trailTop + Math.ceil(trail.length / 2) * 30 + 6

  for (const [label, value] of [
    ['Observaciones', data.notes],
    ['Motivo de la diferencia', data.differenceReason],
    ['Motivo de anulación', data.cancellationReason],
  ] as const) {
    if (!value) continue
    pdf.text(MARGIN, y, label.toUpperCase(), { size: 7, bold: true, gray: 0.5 })
    pdf.text(MARGIN, y + 12, ellipsize(value, RIGHT - MARGIN, 9.5), { size: 9.5 })
    y += 28
  }

  // ── Pie ─────────────────────────────────────────────────────
  // Nunca encima del contenido: si este llegó abajo, el pie baja con él.
  const footerY = Math.max(y + 14, 766)
  pdf.text(
    MARGIN,
    footerY,
    `${data.orderNumber} · ${data.companyName} · ${data.weekLabel} · documento generado por el sistema de nómina`,
    { size: 7.5, gray: 0.55 },
  )

  return pdf.build()
}
