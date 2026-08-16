'use server'

import { revalidatePath } from 'next/cache'
import { assertCan } from '@/lib/auth/rbac'
import {
  agregarDestinatario,
  editarDestinatario,
  quitarDestinatario,
} from '@/lib/mail/dispatch-service'

export async function addReportRecipient(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('settings:manage')
  const text = (key: string) => String(formData.get(key) ?? '')

  const kinds = formData.getAll('kinds').map(String).filter(Boolean)

  const result = await agregarDestinatario(user, {
    name: text('name'),
    email: text('email'),
    kinds,
    paymentRecipientId: text('paymentRecipientId') || null,
    bcc: text('bcc') === 'on',
  })

  revalidatePath('/report-recipients')
  return result.ok ? `LISTO|${result.message}` : result.message
}

export async function toggleReportRecipient(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('settings:manage')

  const result = await quitarDestinatario(user, String(formData.get('id') ?? ''))
  revalidatePath('/report-recipients')
  return result.ok ? `LISTO|${result.message}` : result.message
}

/** El lápiz: corregir el nombre o el correo de un destinatario. */
export async function editReportRecipient(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('settings:manage')
  const text = (key: string) => String(formData.get(key) ?? '')

  const result = await editarDestinatario(user, {
    id: text('id'),
    name: text('name'),
    email: text('email'),
    bcc: text('bcc') === 'on',
  })

  revalidatePath('/report-recipients')
  return result.ok ? `LISTO|${result.message}` : result.message
}
