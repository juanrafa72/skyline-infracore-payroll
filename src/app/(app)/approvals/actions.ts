'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/rbac'
import { applyTransition } from '@/lib/payroll/workflow/service'
import type { WorkflowAction } from '@/lib/payroll/workflow'

/**
 * Aprobar, rechazar o devolver.
 *
 * Quien decide si se puede es la máquina de estados; aquí solo se recogen los
 * ids marcados y se informa qué quedó fuera y por qué. Nunca se aplica "lo que
 * se pudo" en silencio.
 */
async function run(action: WorkflowAction, formData: FormData): Promise<string> {
  const user = await requireUser()
  const ids = formData.getAll('payrollId').map(String).filter(Boolean)
  const reason = String(formData.get('reason') ?? '').trim() || null

  if (ids.length === 0) return 'No marcaste ninguna nómina.'

  const result = await applyTransition(user, ids, action, reason)

  revalidatePath('/approvals')
  revalidatePath('/payments')

  const verb = { APPROVE: 'aprobada', REJECT: 'rechazada', RETURN: 'devuelta' }[
    action as 'APPROVE' | 'REJECT' | 'RETURN'
  ]

  if (result.skipped.length === 0) {
    return `LISTO|${result.moved} nómina(s) ${verb}(s).`
  }

  const detail = result.skipped
    .map((row) => `${row.workerName}: ${row.reason}`)
    .join(' · ')

  return result.moved === 0
    ? `Nada se movió. ${detail}`
    : `PARCIAL|${result.moved} ${verb}(s). Quedaron fuera → ${detail}`
}

export async function approvePayrolls(_previous: string | null, formData: FormData) {
  return run('APPROVE', formData)
}

export async function rejectPayrolls(_previous: string | null, formData: FormData) {
  return run('REJECT', formData)
}

export async function returnPayrolls(_previous: string | null, formData: FormData) {
  return run('RETURN', formData)
}

/** Leo envía la semana a aprobación. */
export async function submitWeek(_previous: string | null, formData: FormData): Promise<string> {
  const user = await requireUser()
  const ids = formData.getAll('payrollId').map(String).filter(Boolean)
  if (ids.length === 0) return 'No hay nóminas calculadas para enviar.'

  const result = await applyTransition(user, ids, 'SUBMIT', null)
  revalidatePath('/payroll')
  revalidatePath('/approvals')

  if (result.skipped.length === 0) {
    return `LISTO|${result.moved} nómina(s) enviada(s) a aprobación.`
  }
  const detail = result.skipped.map((row) => `${row.workerName}: ${row.reason}`).join(' · ')
  return result.moved === 0 ? `Nada se envió. ${detail}` : `PARCIAL|${result.moved} enviada(s). ${detail}`
}
