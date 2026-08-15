'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { assertCan } from '@/lib/auth/rbac'
import { archivarAvisosDelHistorico, cerrarAviso } from '@/lib/payroll/exceptions/service'
import type { CierreAviso } from '@/lib/payroll/exceptions'

/**
 * Los errores de uso se devuelven como mensaje en la URL, no se lanzan: una
 * excepción en una Server Action se ve como una pantalla de error del sistema,
 * y quien intentaba cerrar un aviso creería que rompió algo.
 */
function volver(message: string) {
  redirect(`/avisos?msg=${encodeURIComponent(message)}`)
}

export async function cerrar(formData: FormData) {
  const user = await assertCan('exception:resolve')

  const id = String(formData.get('id') ?? '')
  const cierre = String(formData.get('cierre') ?? 'RESOLVED') as CierreAviso
  const nota = String(formData.get('nota') ?? '')

  const result = await cerrarAviso(user, { id, cierre, nota })
  revalidatePath('/avisos')
  revalidatePath('/inicio')
  revalidatePath('/approvals')
  volver(result.message)
}

export async function archivarHistorico(formData: FormData) {
  const user = await assertCan('exception:resolve')

  const result = await archivarAvisosDelHistorico(user, String(formData.get('nota') ?? ''))
  revalidatePath('/avisos')
  revalidatePath('/inicio')
  volver(result.message)
}
