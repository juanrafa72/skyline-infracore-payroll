import type { CurrentUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { sincronizarDestinatarioDeReceptora } from '@/lib/mail/dispatch-service'
import { findDuplicate, normalizeRecipientName } from './naming'

/**
 * Empresas receptoras de fondos.
 *
 * Los errores de uso se devuelven como mensaje, nunca se lanzan: una excepción
 * en una Server Action se le muestra a la persona como una pantalla rota, no
 * como "ya existe una empresa con ese nombre".
 */

export interface RecipientResult {
  ok: boolean
  message: string
  recipientId?: string
  /** Cuando el nombre se parece a otro pero no es idéntico. */
  warning?: string
}

export interface RecipientInput {
  name: string
  legalName?: string | null
  taxId?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
  bankName?: string | null
  bankAccountLast4?: string | null
  paymentDetails?: string | null
  notes?: string | null
  /** Con esto, un nombre parecido deja de bloquear y se crea igual. */
  confirmDifferent?: boolean
}

function clean(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

export async function createRecipient(
  user: CurrentUser,
  input: RecipientInput,
): Promise<RecipientResult> {
  const name = input.name.trim()
  if (!name) {
    return { ok: false, message: 'Ponle un nombre a la empresa receptora.' }
  }

  const normalizedName = normalizeRecipientName(name)
  if (!normalizedName) {
    return { ok: false, message: 'Ese nombre no tiene letras ni números. Escribe uno que identifique a la empresa.' }
  }

  const existing = await prisma.paymentRecipient.findMany({
    where: { companyId: user.companyId },
    select: { id: true, name: true, normalizedName: true, active: true },
  })

  const duplicate = findDuplicate(name, existing)

  if (duplicate?.kind === 'exact') {
    return { ok: false, message: duplicate.why, recipientId: duplicate.id }
  }
  if (duplicate?.kind === 'similar' && !input.confirmDifferent) {
    return { ok: false, message: duplicate.why, recipientId: duplicate.id }
  }

  const recipient = await prisma.paymentRecipient.create({
    data: {
      companyId: user.companyId,
      name,
      normalizedName,
      legalName: clean(input.legalName),
      taxId: clean(input.taxId),
      contactName: clean(input.contactName),
      email: clean(input.email),
      phone: clean(input.phone),
      bankName: clean(input.bankName),
      bankAccountLast4: clean(input.bankAccountLast4),
      paymentDetails: clean(input.paymentDetails),
      notes: clean(input.notes),
      createdById: user.id,
    },
  })

  await prisma.auditLog.create({
    data: {
      companyId: user.companyId,
      userId: user.id,
      userEmailSnapshot: user.email,
      action: 'PAYMENT_RECIPIENT_CREATED',
      entityType: 'PaymentRecipient',
      entityId: recipient.id,
      newValueJson: { name, taxId: clean(input.taxId) },
      changedFields: ['name'],
      reason: duplicate ? `Creada aun pareciéndose a «${duplicate.name}», confirmado por quien la creó` : null,
    },
  })

  /*
   * Si trae correo, ya queda recibiendo SUS soportes.
   *
   * Lo pidió el negocio: no tener que acordarse de ir a otra pantalla a
   * configurar lo obvio. Se puede quitar o corregir con el lápiz, y entonces
   * el sistema no vuelve a insistir.
   */
  const auto = await sincronizarDestinatarioDeReceptora({
    companyId: user.companyId,
    recipientId: recipient.id,
    name,
    contactName: clean(input.contactName) ?? null,
    email: clean(input.email) ?? null,
  })

  return {
    ok: true,
    message:
      auto.tipo === 'CREAR'
        ? `«${name}» quedó creada y ya se puede asignar. Sus soportes le van a llegar a ${auto.email}.`
        : `«${name}» quedó creada y ya se puede asignar.`,
    recipientId: recipient.id,
  }
}

export async function updateRecipient(
  user: CurrentUser,
  recipientId: string,
  input: RecipientInput,
): Promise<RecipientResult> {
  const current = await prisma.paymentRecipient.findFirst({
    where: { id: recipientId, companyId: user.companyId },
  })
  if (!current) return { ok: false, message: 'Esa empresa receptora no existe.' }

  const name = input.name.trim()
  if (!name) return { ok: false, message: 'El nombre no puede quedar vacío.' }

  const normalizedName = normalizeRecipientName(name)
  if (normalizedName !== current.normalizedName) {
    const clash = await prisma.paymentRecipient.findFirst({
      where: { companyId: user.companyId, normalizedName, NOT: { id: recipientId } },
    })
    if (clash) {
      return { ok: false, message: `Ya hay otra empresa receptora llamada «${clash.name}».` }
    }
  }

  const updated = await prisma.paymentRecipient.update({
    where: { id: recipientId },
    data: {
      name,
      normalizedName,
      legalName: clean(input.legalName),
      taxId: clean(input.taxId),
      contactName: clean(input.contactName),
      email: clean(input.email),
      phone: clean(input.phone),
      bankName: clean(input.bankName),
      bankAccountLast4: clean(input.bankAccountLast4),
      paymentDetails: clean(input.paymentDetails),
      notes: clean(input.notes),
    },
  })

  await prisma.auditLog.create({
    data: {
      companyId: user.companyId,
      userId: user.id,
      userEmailSnapshot: user.email,
      action: 'PAYMENT_RECIPIENT_UPDATED',
      entityType: 'PaymentRecipient',
      entityId: recipientId,
      oldValueJson: { name: current.name, taxId: current.taxId },
      newValueJson: { name: updated.name, taxId: updated.taxId },
      changedFields: ['name', 'taxId', 'contact'],
    },
  })

  // El correo pudo cambiar. Solo se sigue si nadie había tocado el
  // destinatario a mano; esa decisión pesa más que este automatismo.
  const auto = await sincronizarDestinatarioDeReceptora({
    companyId: user.companyId,
    recipientId,
    name,
    contactName: clean(input.contactName) ?? null,
    email: clean(input.email) ?? null,
    emailAnterior: current.email,
  })

  return {
    ok: true,
    message:
      auto.tipo === 'NADA'
        ? `«${name}» quedó actualizada.`
        : `«${name}» quedó actualizada. Sus soportes le van a llegar a ${auto.email}.`,
    recipientId,
  }
}

/**
 * Activa o desactiva.
 *
 * No hay borrado: una receptora con historial contable tiene que seguir
 * existiendo para que sus órdenes viejas sigan diciendo a dónde fue el dinero.
 * La base también lo impide con un trigger.
 */
export async function setRecipientActive(
  user: CurrentUser,
  recipientId: string,
  active: boolean,
): Promise<RecipientResult> {
  const current = await prisma.paymentRecipient.findFirst({
    where: { id: recipientId, companyId: user.companyId },
  })
  if (!current) return { ok: false, message: 'Esa empresa receptora no existe.' }

  if (!active) {
    const pending = await prisma.disbursementOrder.count({
      where: { recipientId, status: { in: ['PENDING_PAYMENT', 'PARTIALLY_PAID'] } },
    })
    if (pending > 0) {
      return {
        ok: false,
        message: `«${current.name}» tiene ${pending} orden(es) sin pagar. Págalas o anúlalas antes de desactivarla.`,
      }
    }

    const assigned = await prisma.workerPayroll.count({
      where: {
        companyId: user.companyId,
        paymentRecipientId: recipientId,
        status: { in: ['PENDING_APPROVAL', 'APPROVED', 'READY_TO_PAY', 'PAYMENT_IN_PROCESS'] },
      },
    })
    if (assigned > 0) {
      return {
        ok: false,
        message: `«${current.name}» está asignada a ${assigned} nómina(s) en curso. Cámbiales la empresa receptora antes de desactivarla.`,
      }
    }
  }

  await prisma.paymentRecipient.update({ where: { id: recipientId }, data: { active } })

  await prisma.auditLog.create({
    data: {
      companyId: user.companyId,
      userId: user.id,
      userEmailSnapshot: user.email,
      action: active ? 'PAYMENT_RECIPIENT_ACTIVATED' : 'PAYMENT_RECIPIENT_DEACTIVATED',
      entityType: 'PaymentRecipient',
      entityId: recipientId,
      oldValueJson: { active: current.active },
      newValueJson: { active },
      changedFields: ['active'],
    },
  })

  return {
    ok: true,
    message: active
      ? `«${current.name}» quedó activa.`
      : `«${current.name}» quedó inactiva. Su historial se conserva.`,
  }
}

/** Empresas receptoras que se pueden asignar hoy. */
export async function activeRecipients(companyId: string) {
  return prisma.paymentRecipient.findMany({
    where: { companyId, active: true },
    orderBy: { name: 'asc' },
  })
}
