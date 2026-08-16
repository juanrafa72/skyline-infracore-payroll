/**
 * A quién le toca cada reporte.
 *
 * El negocio lo pidió con dos casos: la auxiliar contable recibe todo, y la
 * empresa receptora recibe SU desprendible. De ahí las dos formas de un
 * destinatario: general (sin empresa atada) o específico de una receptora.
 *
 * Puro: la regla de quién recibe qué se prueba sin base de datos, porque
 * mandarle a un contratista el desprendible de otro es un problema serio.
 */

export type ReportKind = 'DISBURSEMENT_PDF' | 'WEEKLY_SUMMARY' | 'OTHER'

/**
 * Consecutivo de un reporte enviado: `RP-SKYLINE-2026-0012`.
 *
 * El negocio lo pidió explícito: «cada reporte debe tener un consecutivo
 * único». Sirve para que contabilidad pueda decir «me falta el RP-…-0011» y
 * saber que algo no llegó — con un asunto de correo repetido eso es imposible.
 *
 * Vive aquí, con el resto de lo puro, y no junto a la consulta que saca el
 * número: así se puede probar sin base de datos.
 */
export function formatReportNumber(companyCode: string, year: number, number: number): string {
  return `RP-${companyCode}-${year}-${String(number).padStart(4, '0')}`
}

export const TIPO_REPORTE: Record<ReportKind, string> = {
  DISBURSEMENT_PDF: 'Desprendible de la orden',
  WEEKLY_SUMMARY: 'Resumen de la semana',
  OTHER: 'Otro reporte',
}

export interface DestinatarioConfigurado {
  id: string
  name: string
  email: string
  /** Vacío = recibe todos los tipos. */
  kinds: readonly string[]
  /** Atado a una empresa receptora: solo recibe SUS órdenes. */
  paymentRecipientId: string | null
  bcc: boolean
  active: boolean
}

/**
 * Quiénes reciben este reporte.
 *
 * Tres filtros, y el tercero es el que evita el error caro:
 *  1. activo,
 *  2. le corresponde ese tipo de reporte,
 *  3. si está atado a una empresa receptora, la orden tiene que ser de ESA
 *     empresa. Un destinatario atado a FORZO **jamás** recibe el desprendible
 *     de Quintero.
 */
export function destinatariosDe(
  todos: readonly DestinatarioConfigurado[],
  reporte: { kind: ReportKind; paymentRecipientId?: string | null },
): DestinatarioConfigurado[] {
  return todos.filter((d) => {
    if (!d.active) return false
    if (d.kinds.length > 0 && !d.kinds.includes(reporte.kind)) return false
    if (d.paymentRecipientId && d.paymentRecipientId !== reporte.paymentRecipientId) return false
    return true
  })
}

/** Quita repetidos por correo: si alguien está dos veces, le llega una sola. */
export function sinRepetidos(
  destinatarios: readonly DestinatarioConfigurado[],
): DestinatarioConfigurado[] {
  const vistos = new Set<string>()
  const salida: DestinatarioConfigurado[] = []
  for (const d of destinatarios) {
    const clave = d.email.trim().toLowerCase()
    if (vistos.has(clave)) continue
    vistos.add(clave)
    salida.push(d)
  }
  return salida
}

/** ¿Esto parece un correo? La misma forma que exige el CHECK de la base. */
export function correoValido(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
}

/**
 * El asunto del correo.
 *
 * Lleva el consecutivo adelante para que contabilidad pueda ordenar por asunto
 * y ver de un vistazo si le falta un número.
 */
export function asuntoDe(input: {
  reportNumber: string
  kind: ReportKind
  companyName: string
  orderNumber?: string | null
  weekLabel?: string | null
}): string {
  const partes = [input.reportNumber, TIPO_REPORTE[input.kind], input.companyName]
  if (input.orderNumber) partes.push(input.orderNumber)
  if (input.weekLabel) partes.push(input.weekLabel)
  return partes.join(' · ')
}

/** El cuerpo. Corto y en español: lo importante va en el adjunto. */
export function cuerpoDe(input: {
  reportNumber: string
  companyName: string
  orderNumber?: string | null
  recipientName?: string | null
  weekLabel?: string | null
  total?: string | null
  enviadoPor?: string | null
}): string {
  const lineas = [
    `Reporte ${input.reportNumber} de ${input.companyName}.`,
    '',
  ]
  if (input.orderNumber) lineas.push(`Orden de desembolso: ${input.orderNumber}`)
  if (input.recipientName) lineas.push(`Empresa receptora: ${input.recipientName}`)
  if (input.weekLabel) lineas.push(`Período: ${input.weekLabel}`)
  if (input.total) lineas.push(`Total: $${input.total}`)
  lineas.push('', 'El detalle va en el archivo adjunto.')
  if (input.enviadoPor) lineas.push('', `Enviado por ${input.enviadoPor}.`)
  lineas.push('', 'Mensaje generado por el sistema de nómina. No responder a este correo.')
  return lineas.join('\n')
}

export const ESTADO_ENVIO: Record<string, string> = {
  QUEUED: 'Pendiente de enviar',
  SENT: 'Enviado',
  FAILED: 'Falló',
}
