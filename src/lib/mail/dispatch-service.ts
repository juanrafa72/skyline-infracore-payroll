import type { CurrentUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { nextNumber } from '@/lib/disbursement/sequence'
import { buildDisbursementPdf } from '@/lib/pdf/build-disbursement'
import { transporteDe } from './transport'
import {
  asuntoDe,
  correoValido,
  cuerpoDe,
  destinatariosDe,
  formatReportNumber,
  sinRepetidos,
  type DestinatarioConfigurado,
  type ReportKind,
} from './reports'

/**
 * Mandar reportes por correo, dejando constancia.
 *
 * Cada envío lleva su **consecutivo único** (`RP-SKYLINE-2026-0012`), a quién
 * iba con el correo congelado, y en qué quedó. El negocio lo pidió así:
 * poder sistematizar el envío del soporte a la auxiliar contable y a la
 * empresa receptora.
 *
 * Las reglas de quién recibe qué viven en `./reports.ts`, que es puro.
 */

export interface DispatchResult {
  ok: boolean
  message: string
  reportNumber?: string
}

/**
 * Manda el desprendible de una orden a quien corresponda.
 *
 * El registro se crea SIEMPRE, incluso si el correo no sale: así queda el
 * consecutivo, a quién iba, y el motivo del fallo. Un envío fallido que no
 * deja rastro se repite sin que nadie se entere.
 */
export async function enviarDesprendible(
  user: CurrentUser,
  orderId: string,
): Promise<DispatchResult> {
  const order = await prisma.disbursementOrder.findFirst({
    where: { id: orderId, companyId: user.companyId },
  })
  if (!order) return { ok: false, message: 'Esa orden no existe en esta compañía.' }

  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } })

  const configurados = await prisma.reportRecipient.findMany({
    where: { companyId: user.companyId, active: true },
  })

  const elegidos = sinRepetidos(
    destinatariosDe(
      configurados.map(
        (d): DestinatarioConfigurado => ({
          id: d.id,
          name: d.name,
          email: d.email,
          kinds: d.kinds,
          paymentRecipientId: d.paymentRecipientId,
          bcc: d.bcc,
          active: d.active,
        }),
      ),
      { kind: 'DISBURSEMENT_PDF', paymentRecipientId: order.recipientId },
    ),
  ).filter((d) => correoValido(d.email))

  if (elegidos.length === 0) {
    return {
      ok: false,
      message:
        'No hay a quién mandárselo. Agrega los correos en Catálogos → Envío de reportes: ' +
        'uno general para contabilidad y, si quieres, uno por empresa receptora.',
    }
  }

  const year = order.periodEnd.getUTCFullYear()

  /*
   * El consecutivo se saca en su propia transacción, ANTES de intentar el
   * envío. Si el correo falla, el número ya está gastado y el registro dice
   * por qué falló: es preferible un hueco explicable en la serie a dos
   * reportes con el mismo número.
   */
  const numero = await nextNumber(user.companyId, 'REPORT_DISPATCH', year)
  const reportNumber = formatReportNumber(company.code, year, numero)

  const subject = asuntoDe({
    reportNumber,
    kind: 'DISBURSEMENT_PDF',
    companyName: company.displayName,
    orderNumber: order.orderNumber,
    weekLabel: order.weekLabelSnapshot,
  })

  const dispatch = await prisma.reportDispatch.create({
    data: {
      companyId: user.companyId,
      reportNumber,
      kind: 'DISBURSEMENT_PDF',
      disbursementOrderId: order.id,
      subject,
      fileName: `${order.orderNumber}.pdf`,
      status: 'QUEUED',
      sentById: user.id,
      sentByName: user.name,
      targets: {
        create: elegidos.map((d) => ({
          reportRecipientId: d.id,
          emailSnapshot: d.email,
          nameSnapshot: d.name,
          bcc: d.bcc,
        })),
      },
    },
  })

  let pdf: Uint8Array
  try {
    const built = await buildDisbursementPdf(user.companyId, order.id)
    if (!built) throw new Error('la orden desapareció')
    pdf = new Uint8Array(built.pdf)
  } catch (error) {
    await marcarFallo(dispatch.id, `No se pudo generar el PDF: ${(error as Error).message}`)
    return {
      ok: false,
      message: `${reportNumber}: no se pudo generar el desprendible. Quedó registrado como fallido.`,
      reportNumber,
    }
  }

  // El remitente sale de la compañía del reporte: Skyline e Infracore mandan
  // desde dominios distintos y cruzarlos confunde a quien recibe.
  const transporte = transporteDe(company.code)
  const resultado = await transporte.enviar({
    to: elegidos.map((d) => ({ name: d.name, email: d.email, bcc: d.bcc })),
    subject,
    text: cuerpoDe({
      reportNumber,
      companyName: company.displayName,
      orderNumber: order.orderNumber,
      recipientName: order.recipientNameSnapshot,
      weekLabel: order.weekLabelSnapshot,
      total: order.totalAmount.toFixed(2),
      enviadoPor: user.name,
    }),
    attachments: [
      { fileName: `${order.orderNumber}.pdf`, content: pdf, contentType: 'application/pdf' },
    ],
  })

  if (!resultado.ok) {
    await marcarFallo(dispatch.id, resultado.message)
    return {
      ok: false,
      message: `${reportNumber}: ${resultado.message}`,
      reportNumber,
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.reportDispatch.update({
      where: { id: dispatch.id },
      data: { status: 'SENT', sentAt: new Date() },
    })
    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'REPORT_SENT',
        entityType: 'DisbursementOrder',
        entityId: order.id,
        newValueJson: {
          reportNumber,
          para: elegidos.map((d) => d.email),
        },
        changedFields: ['reportDispatch'],
        reason: `Desprendible ${order.orderNumber} enviado`,
      },
    })
  })

  const quienes = elegidos.map((d) => d.name).join(', ')
  return { ok: true, message: `${reportNumber} enviado a ${quienes}.`, reportNumber }
}

async function marcarFallo(dispatchId: string, motivo: string): Promise<void> {
  await prisma.reportDispatch.update({
    where: { id: dispatchId },
    data: { status: 'FAILED', failureReason: motivo },
  })
}

export interface EnvioView {
  id: string
  reportNumber: string
  kind: ReportKind
  subject: string
  status: string
  failureReason: string | null
  sentByName: string | null
  createdAt: string
  sentAt: string | null
  orderNumber: string | null
  targets: Array<{ name: string; email: string; bcc: boolean }>
}

/** Los envíos de una orden, del más nuevo al más viejo. */
export async function enviosDeOrden(
  companyId: string,
  orderId: string,
): Promise<EnvioView[]> {
  const filas = await prisma.reportDispatch.findMany({
    where: { companyId, disbursementOrderId: orderId },
    include: { targets: true, order: { select: { orderNumber: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return filas.map((fila) => ({
    id: fila.id,
    reportNumber: fila.reportNumber,
    kind: fila.kind as ReportKind,
    subject: fila.subject,
    status: fila.status,
    failureReason: fila.failureReason,
    sentByName: fila.sentByName,
    createdAt: fila.createdAt.toISOString().slice(0, 16).replace('T', ' '),
    sentAt: fila.sentAt ? fila.sentAt.toISOString().slice(0, 16).replace('T', ' ') : null,
    orderNumber: fila.order?.orderNumber ?? null,
    targets: fila.targets.map((t) => ({
      name: t.nameSnapshot,
      email: t.emailSnapshot,
      bcc: t.bcc,
    })),
  }))
}

// ─────────────────────────────────────────────────────────────
// Destinatarios configurados
// ─────────────────────────────────────────────────────────────

export interface RecipientResult {
  ok: boolean
  message: string
}

export async function agregarDestinatario(
  user: CurrentUser,
  input: {
    name: string
    email: string
    kinds?: string[]
    paymentRecipientId?: string | null
    bcc?: boolean
  },
): Promise<RecipientResult> {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()

  if (!name) return { ok: false, message: 'Ponle un nombre para reconocerlo en la lista.' }
  if (!correoValido(email)) {
    return { ok: false, message: `«${input.email}» no es un correo válido.` }
  }

  const yaEsta = await prisma.reportRecipient.findFirst({
    where: {
      companyId: user.companyId,
      email,
      paymentRecipientId: input.paymentRecipientId || null,
    },
  })
  if (yaEsta) {
    return { ok: false, message: `${email} ya está en la lista para ese caso.` }
  }

  await prisma.reportRecipient.create({
    data: {
      companyId: user.companyId,
      name,
      email,
      kinds: input.kinds ?? [],
      paymentRecipientId: input.paymentRecipientId || null,
      bcc: input.bcc ?? false,
    },
  })

  return { ok: true, message: `${name} (${email}) va a recibir los reportes.` }
}

/**
 * Cambiar el nombre o el correo de un destinatario — el lápiz.
 *
 * Lo pidió el negocio: el correo de contabilidad viene puesto por defecto,
 * pero si Ana cambia de correo o de empresa, tiene que poderse corregir en el
 * momento y sin ayuda de nadie. Un dato que solo se puede arreglar borrando y
 * volviendo a crear termina duplicado.
 *
 * Lo que NO cambia aquí es a qué empresa receptora está atado: eso decide qué
 * órdenes recibe, y cambiarlo de una vez con el correo haría que alguien
 * empiece a ver desprendibles de un tercero sin darse cuenta. Para eso se
 * agrega otro y se desactiva este.
 */
export async function editarDestinatario(
  user: CurrentUser,
  input: { id: string; name: string; email: string; bcc?: boolean },
): Promise<RecipientResult> {
  const fila = await prisma.reportRecipient.findFirst({
    where: { id: input.id, companyId: user.companyId },
  })
  if (!fila) return { ok: false, message: 'Ese destinatario no existe en esta compañía.' }

  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()

  if (!name) return { ok: false, message: 'Ponle un nombre para reconocerlo en la lista.' }
  if (!correoValido(email)) {
    return { ok: false, message: `«${input.email}» no es un correo válido.` }
  }

  // El mismo correo, para el mismo caso, dos veces: recibiría todo duplicado.
  const chocaCon = await prisma.reportRecipient.findFirst({
    where: {
      companyId: user.companyId,
      email,
      paymentRecipientId: fila.paymentRecipientId,
      id: { not: fila.id },
    },
  })
  if (chocaCon) return { ok: false, message: `${email} ya está en la lista para ese caso.` }

  await prisma.reportRecipient.update({
    where: { id: fila.id },
    data: { name, email, bcc: input.bcc ?? fila.bcc },
  })

  /*
   * Los envíos ya hechos NO se tocan: cada uno guardó a qué correo salió
   * (`emailSnapshot`). Cambiar el destinatario de hoy no puede reescribir a
   * dónde llegó un reporte de hace tres semanas.
   */
  return {
    ok: true,
    message:
      email === fila.email
        ? `Ahora se llama ${name}.`
        : `Los reportes van a llegar a ${email}.`,
  }
}

export async function quitarDestinatario(
  user: CurrentUser,
  id: string,
): Promise<RecipientResult> {
  const fila = await prisma.reportRecipient.findFirst({
    where: { id, companyId: user.companyId },
  })
  if (!fila) return { ok: false, message: 'Ese destinatario no existe en esta compañía.' }

  // Se desactiva, no se borra: los envíos ya hechos apuntan a él, y el
  // histórico de a quién se le mandó no se toca.
  await prisma.reportRecipient.update({ where: { id }, data: { active: !fila.active } })

  return {
    ok: true,
    message: fila.active
      ? `${fila.name} deja de recibir reportes.`
      : `${fila.name} vuelve a recibir reportes.`,
  }
}
