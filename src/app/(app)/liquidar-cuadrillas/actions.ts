'use server'

import { revalidatePath } from 'next/cache'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { syncCrewPayrolls } from '@/lib/payroll/crews/service'

/**
 * Calcular las cuadrillas de una semana desde su propia pantalla.
 *
 * Existe aparte de «Calcular nómina» porque las cuadrillas no van al mismo
 * ritmo que la gente: la nómina puede ir en la semana 33 mientras Hugo se
 * liquida por la 25 y Jesús por la 30, según cuándo llegue la medición de lo
 * construido. Obligar a abrir la semana de la gente para liquidar una cuadrilla
 * mezclaba dos calendarios que el negocio lleva por separado.
 *
 * Recalcula TODAS las cuadrillas de esa semana, no solo la que se está viendo:
 * el cálculo sale de la producción capturada y es el mismo trabajo. Hacerlo
 * «solo para esta» daría la falsa impresión de que las otras quedaron intactas
 * cuando en realidad nunca se tocaron.
 */
export async function calcularCuadrillasDeLaSemana(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  await assertCan('payroll:edit')
  const company = await getActiveCompany()
  const weekId = String(formData.get('weekId') ?? '')

  if (!weekId) return 'Escoge primero la semana que vas a liquidar.'

  const resultado = await syncCrewPayrolls(company.id, weekId)

  revalidatePath('/liquidar-cuadrillas')
  revalidatePath(`/payroll/${weekId}`)
  return resultado.ok ? `LISTO|${resultado.message}` : resultado.message
}
