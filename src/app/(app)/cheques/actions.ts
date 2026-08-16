'use server'

import { revalidatePath } from 'next/cache'
import { assertCan } from '@/lib/auth/rbac'
import {
  anotarDescuento,
  anotarDevolucion,
  registrarCheque,
  registrarLoQueEntro,
} from '@/lib/cobros/service'
import type { ClaseDescuento } from '@/lib/cobros'

const texto = (formData: FormData, clave: string) => String(formData.get(clave) ?? '')

export async function crearCheque(_previo: string | null, formData: FormData): Promise<string> {
  const user = await assertCan('payment:view')

  const resultado = await registrarCheque(user, {
    customerId: texto(formData, 'customerId'),
    reference: texto(formData, 'reference'),
    expectedAmount: texto(formData, 'expectedAmount').trim(),
    weekIds: formData.getAll('weekId').map(String).filter(Boolean),
    notes: texto(formData, 'notes'),
  })

  revalidatePath('/cheques')
  return resultado.ok ? `LISTO|${resultado.message}` : resultado.message
}

export async function guardarLoQueEntro(
  _previo: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payment:view')

  const resultado = await registrarLoQueEntro(user, {
    checkId: texto(formData, 'checkId'),
    receivedAmount: texto(formData, 'receivedAmount').trim(),
    receivedDate: texto(formData, 'receivedDate'),
  })

  revalidatePath('/cheques')
  revalidatePath('/retenciones')
  return resultado.ok ? `LISTO|${resultado.message}` : resultado.message
}

export async function guardarDescuento(
  _previo: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payment:view')

  const resultado = await anotarDescuento(user, {
    checkId: texto(formData, 'checkId'),
    clase: texto(formData, 'clase') as ClaseDescuento,
    amount: texto(formData, 'amount').trim(),
    reason: texto(formData, 'reason'),
    projectId: texto(formData, 'projectId') || null,
  })

  revalidatePath('/cheques')
  revalidatePath('/retenciones')
  return resultado.ok ? `LISTO|${resultado.message}` : resultado.message
}

/** Anotar que devolvieron (parte de) una retención. */
export async function guardarDevolucion(
  _previo: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payment:view')

  const resultado = await anotarDevolucion(user, {
    deductionId: texto(formData, 'deductionId'),
    amount: texto(formData, 'amount').trim(),
    date: texto(formData, 'date'),
    note: texto(formData, 'note'),
  })

  revalidatePath('/retenciones')
  revalidatePath('/cheques')
  return resultado.ok ? `LISTO|${resultado.message}` : resultado.message
}
