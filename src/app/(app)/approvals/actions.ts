'use server'

import { revalidatePath } from 'next/cache'
import { assertCan, requireUser } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { assignRecipient, generateOrders } from '@/lib/disbursement/orders'
import { createRecipient } from '@/lib/disbursement/recipients'
import { applyTransition } from '@/lib/payroll/workflow/service'
import { applyPayableTransition } from '@/lib/payroll/workflow/payables'
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

  /*
   * Aprobar y ordenar el desembolso son el mismo acto.
   *
   * Si se dejaran separados, una nómina podría quedar aprobada sin que nadie
   * sepa a quién transferirle, que es exactamente el hueco que este flujo
   * viene a tapar. Se generan aquí, agrupadas por semana y empresa receptora.
   */
  let orders = ''
  if (action === 'APPROVE' && result.moved > 0) {
    const generated = await generateOrders(user, ids)
    if (generated.ok && generated.orderNumbers && generated.orderNumbers.length > 0) {
      orders = ` ${generated.message}`
    } else if (!generated.ok) {
      orders = ` OJO: ${generated.message}`
    }
    revalidatePath('/disbursements')
  }

  revalidatePath('/approvals')
  revalidatePath('/payments')

  const verb = { APPROVE: 'aprobada', REJECT: 'rechazada', RETURN: 'devuelta' }[
    action as 'APPROVE' | 'REJECT' | 'RETURN'
  ]

  if (result.skipped.length === 0) {
    return `LISTO|${result.moved} nómina(s) ${verb}(s).${orders}`
  }

  const detail = result.skipped
    .map((row) => `${row.workerName}: ${row.reason}`)
    .join(' · ')

  return result.moved === 0
    ? `Nada se movió. ${detail}`
    : `PARCIAL|${result.moved} ${verb}(s).${orders} Quedaron fuera → ${detail}`
}

/**
 * Asigna la empresa receptora a las nóminas marcadas.
 *
 * La misma acción sirve para una persona o para cincuenta: quien aprueba marca
 * a todos los que se pagan con fondos a la misma empresa y los asigna de una.
 */
export async function assignRecipientAction(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payroll:approve')
  const ids = formData.getAll('payrollId').map(String).filter(Boolean)
  const recipientId = String(formData.get('recipientId') ?? '')

  if (!recipientId) return 'Escoge la empresa receptora.'

  const result = await assignRecipient(user, ids, recipientId)
  revalidatePath('/approvals')
  return result.ok ? `LISTO|${result.message}` : result.message
}

/**
 * Crea una empresa receptora sin salir de la aprobación, y la deja asignada a
 * quienes estén marcados. Tener que irse a otra pantalla en mitad de la
 * revisión es la clase de fricción que hace que la gente se salte el paso.
 */
export async function createAndAssignRecipient(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payroll:approve')
  const ids = formData.getAll('payrollId').map(String).filter(Boolean)

  const created = await createRecipient(user, {
    name: String(formData.get('name') ?? ''),
    legalName: String(formData.get('legalName') ?? ''),
    taxId: String(formData.get('taxId') ?? ''),
    contactName: String(formData.get('contactName') ?? ''),
    email: String(formData.get('email') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    bankName: String(formData.get('bankName') ?? ''),
    bankAccountLast4: String(formData.get('bankAccountLast4') ?? ''),
    paymentDetails: String(formData.get('paymentDetails') ?? ''),
    notes: String(formData.get('notes') ?? ''),
    confirmDifferent: String(formData.get('confirmDifferent') ?? '') === '1',
  })

  if (!created.ok || !created.recipientId) {
    revalidatePath('/approvals')
    return created.message
  }

  if (ids.length === 0) {
    revalidatePath('/approvals')
    revalidatePath('/recipients')
    return `LISTO|${created.message}`
  }

  const assigned = await assignRecipient(user, ids, created.recipientId)
  revalidatePath('/approvals')
  revalidatePath('/recipients')

  return assigned.ok
    ? `LISTO|${created.message} ${assigned.message}`
    : `${created.message} Pero no se pudo asignar: ${assigned.message}`
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
  const crewIds = formData.getAll('crewPayrollId').map(String).filter(Boolean)
  if (ids.length === 0 && crewIds.length === 0) {
    return 'No hay nóminas calculadas para enviar.'
  }

  const result =
    ids.length > 0
      ? await applyTransition(user, ids, 'SUBMIT', null)
      : { moved: 0, skipped: [] as Array<{ workerName: string; reason: string }> }

  // Las liquidaciones de cuadrilla viajan en el mismo envío: mismo motor,
  // delegado distinto.
  const crews =
    crewIds.length > 0
      ? await applyPayableTransition(user, 'CREW', crewIds, 'SUBMIT', null)
      : { moved: 0, skipped: [] as Array<{ name: string; reason: string }> }

  revalidatePath('/payroll')
  revalidatePath('/approvals')

  const moved = result.moved + crews.moved
  const skipped = [
    ...result.skipped.map((row) => `${row.workerName}: ${row.reason}`),
    ...crews.skipped.map((row) => `${row.name}: ${row.reason}`),
  ]

  const summary =
    crews.moved > 0
      ? `${result.moved} nómina(s) y ${crews.moved} cuadrilla(s) enviada(s) a aprobación.`
      : `${result.moved} nómina(s) enviada(s) a aprobación.`

  if (skipped.length === 0) return `LISTO|${summary}`
  const detail = skipped.join(' · ')
  return moved === 0 ? `Nada se envió. ${detail}` : `PARCIAL|${summary} Quedaron fuera → ${detail}`
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
