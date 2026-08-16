'use server'

import { revalidatePath } from 'next/cache'
import { assertCan } from '@/lib/auth/rbac'
import {
  agregarDocumento,
  reemplazarDocumento,
} from '@/lib/equipment/records-service'
import type { RecordKind } from '@/lib/equipment/records'

/**
 * Los errores de uso se devuelven como mensaje, no se lanzan: una excepción en
 * una Server Action se ve como una pantalla de error del sistema.
 */

export async function addRecord(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('equipment:manage')
  const text = (key: string) => String(formData.get(key) ?? '')

  const result = await agregarDocumento(user, {
    equipmentId: text('equipmentId'),
    kind: text('kind') as RecordKind,
    title: text('title'),
    reference: text('reference'),
    issuedAt: text('issuedAt'),
    expiresAt: text('expiresAt'),
    alertDaysBefore: Number(text('alertDaysBefore') || '30'),
    meterAtService: text('meterAtService'),
    nextServiceMeter: text('nextServiceMeter'),
    fileName: text('fileName'),
    fileRef: text('fileRef'),
    cost: text('cost'),
    vendorId: text('vendorId'),
    notes: text('notes'),
  })

  revalidatePath(`/equipment/${text('equipmentId')}`)
  revalidatePath('/inicio')
  return result.ok ? `LISTO|${result.message}` : result.message
}

export async function archiveRecord(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('equipment:manage')

  const result = await reemplazarDocumento(user, String(formData.get('recordId') ?? ''))
  revalidatePath(`/equipment/${String(formData.get('equipmentId') ?? '')}`)
  revalidatePath('/inicio')
  return result.ok ? `LISTO|${result.message}` : result.message
}
