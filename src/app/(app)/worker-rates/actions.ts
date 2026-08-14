'use server'

import { revalidatePath } from 'next/cache'
import { assertCan } from '@/lib/auth/rbac'
import { saveMissingRate } from '@/lib/payroll/rates-status/service'

/**
 * Guardado masivo de tarifas faltantes.
 *
 * El formulario manda un campo por persona (`tarifa:<workerId>` y
 * `desde:<workerId>`). Las filas vacías no son un error: son gente cuya
 * tarifa todavía no se sabe. Cada fila se guarda por separado — una tarifa
 * mal escrita no puede tumbar las otras sesenta.
 */
export async function saveMissingRates(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('rate:manage')

  const amounts = new Map<string, string>()
  const froms = new Map<string, string>()

  for (const [key, value] of formData.entries()) {
    if (typeof value !== 'string') continue
    if (key.startsWith('tarifa:')) {
      const workerId = key.slice('tarifa:'.length)
      if (workerId && value.trim() !== '') amounts.set(workerId, value.trim())
    }
    if (key.startsWith('desde:')) {
      const workerId = key.slice('desde:'.length)
      if (workerId && value.trim() !== '') froms.set(workerId, value.trim())
    }
  }

  if (amounts.size === 0) {
    return 'No escribiste ninguna tarifa. Llena el monto de al menos una persona.'
  }

  let saved = 0
  const failures: string[] = []

  for (const [workerId, amount] of amounts) {
    const effectiveFrom = froms.get(workerId) ?? ''
    const result = await saveMissingRate(user, { workerId, amount, effectiveFrom })
    if (result.ok) saved += 1
    else failures.push(result.message)
  }

  revalidatePath('/worker-rates')
  revalidatePath('/workers')
  revalidatePath('/dashboard')

  if (failures.length === 0) {
    return `LISTO|${saved === 1 ? 'Se guardó 1 tarifa.' : `Se guardaron ${saved} tarifas.`}`
  }
  if (saved === 0) {
    return `No se guardó ninguna. ${failures.join(' · ')}`
  }
  return `PARCIAL|Se guardaron ${saved}. Fallaron ${failures.length}: ${failures.join(' · ')}`
}
