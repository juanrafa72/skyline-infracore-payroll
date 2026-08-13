'use server'

import { revalidatePath } from 'next/cache'
import { assertCan } from '@/lib/auth/rbac'
import {
  createRecipient,
  setRecipientActive,
  updateRecipient,
  type RecipientInput,
} from '@/lib/disbursement/recipients'

/**
 * Empresas receptoras de fondos.
 *
 * Las puede administrar quien aprueba, porque es quien decide a dónde va el
 * dinero. Todo devuelve un mensaje: nada lanza.
 */

function readInput(formData: FormData): RecipientInput {
  const value = (key: string) => {
    const raw = formData.get(key)
    return typeof raw === 'string' ? raw : ''
  }

  return {
    name: value('name'),
    legalName: value('legalName'),
    taxId: value('taxId'),
    contactName: value('contactName'),
    email: value('email'),
    phone: value('phone'),
    bankName: value('bankName'),
    bankAccountLast4: value('bankAccountLast4'),
    paymentDetails: value('paymentDetails'),
    notes: value('notes'),
    confirmDifferent: value('confirmDifferent') === '1',
  }
}

function revalidateAll(): void {
  revalidatePath('/recipients')
  revalidatePath('/approvals')
  revalidatePath('/disbursements')
}

export async function createRecipientAction(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payroll:approve')
  const result = await createRecipient(user, readInput(formData))
  revalidateAll()
  return result.ok ? `LISTO|${result.message}` : result.message
}

export async function updateRecipientAction(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payroll:approve')
  const id = String(formData.get('recipientId') ?? '')
  if (!id) return 'Falta indicar cuál empresa receptora.'

  const result = await updateRecipient(user, id, readInput(formData))
  revalidateAll()
  return result.ok ? `LISTO|${result.message}` : result.message
}

export async function toggleRecipientActive(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payroll:approve')
  const id = String(formData.get('recipientId') ?? '')
  const active = String(formData.get('active') ?? '') === '1'
  if (!id) return 'Falta indicar cuál empresa receptora.'

  const result = await setRecipientActive(user, id, active)
  revalidateAll()
  return result.ok ? `LISTO|${result.message}` : result.message
}
