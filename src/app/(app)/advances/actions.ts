'use server'

import { revalidatePath } from 'next/cache'
import { assertCan } from '@/lib/auth/rbac'
import {
  approveAdvance,
  cancelAdvance,
  createAdvance,
  recordRepayment,
} from '@/lib/advances/service'
import type { BeneficiaryType, RecoveryMethod } from '@/lib/advances'

/**
 * Préstamos y financiaciones.
 *
 * Crear lo puede hacer quien prepara; aprobar exige el permiso de aprobar
 * anticipos, y además que sea otra persona — la misma separación de funciones
 * que rige la nómina.
 */

function text(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

export async function createAdvanceAction(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('advance:create')

  const result = await createAdvance(user, {
    beneficiaryType: text(formData, 'beneficiaryType') as BeneficiaryType,
    beneficiaryId: text(formData, 'beneficiaryId'),
    amount: text(formData, 'amount'),
    reason: text(formData, 'reason'),
    requestDate: text(formData, 'requestDate'),
    recoveryMethod: text(formData, 'recoveryMethod') as RecoveryMethod,
    recoveryAmount: text(formData, 'recoveryAmount'),
    recoveryPct: text(formData, 'recoveryPct'),
    recoveryCap: text(formData, 'recoveryCap'),
    notes: text(formData, 'notes'),
  })

  revalidatePath('/advances')
  return result.ok ? `LISTO|${result.message}` : result.message
}

export async function approveAdvanceAction(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('advance:approve')
  const result = await approveAdvance(user, text(formData, 'advanceId'))
  revalidatePath('/advances')
  return result.ok ? `LISTO|${result.message}` : result.message
}

export async function cancelAdvanceAction(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('advance:approve')
  const result = await cancelAdvance(user, text(formData, 'advanceId'), text(formData, 'reason'))
  revalidatePath('/advances')
  return result.ok ? `LISTO|${result.message}` : result.message
}

export async function recordRepaymentAction(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('advance:create')
  const result = await recordRepayment(
    user,
    text(formData, 'advanceId'),
    text(formData, 'amount'),
    text(formData, 'notes') || null,
  )
  revalidatePath('/advances')
  return result.ok ? `LISTO|${result.message}` : result.message
}
