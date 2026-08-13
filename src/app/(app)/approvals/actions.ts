'use server'

import { revalidatePath } from 'next/cache'
import { assertCan, requireUser } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
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

/**
 * Enciende o apaga el modo de una sola persona.
 *
 * Con él activo, quien preparó puede aprobar y quien aprobó puede pagar. Cada
 * nómina que pase así queda marcada. Solo lo puede cambiar quien administra.
 */
export async function toggleSelfApproval(formData: FormData) {
  const actor = await assertCan('settings:manage')
  const company = await getActiveCompany()
  const enable = String(formData.get('enable') ?? '') === '1'

  await prisma.companySetting.upsert({
    where: { companyId_key: { companyId: company.id, key: 'workflow.allow_self_approval' } },
    update: { value: String(enable), confirmedById: actor.id, confirmedAt: new Date() },
    create: {
      companyId: company.id,
      key: 'workflow.allow_self_approval',
      value: String(enable),
      valueType: 'boolean',
      confirmed: true,
      confirmedById: actor.id,
      confirmedAt: new Date(),
      description:
        'Permite que la misma persona prepare y apruebe, o apruebe y pague. Cada nómina que ' +
        'pase así queda marcada.',
    },
  })

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      userId: actor.id,
      userEmailSnapshot: actor.email,
      action: enable ? 'SELF_APPROVAL_ENABLED' : 'SELF_APPROVAL_DISABLED',
      entityType: 'CompanySetting',
      entityId: company.id,
      newValueJson: { allowSelfApproval: enable },
      changedFields: ['workflow.allow_self_approval'],
      reason: enable
        ? 'Se permite que una sola persona haga todo el proceso'
        : 'Se restablece la separación de funciones',
    },
  })

  revalidatePath('/approvals')
}
