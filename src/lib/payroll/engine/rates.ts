import type { RateInput, RateType, Shift } from './types'

/**
 * Resuelve la tarifa vigente para un día — BR-031.
 *
 * Precedencia, de más específica a más general:
 *   1. proyecto + turno
 *   2. proyecto
 *   3. turno
 *   4. operación
 *   5. general
 *
 * Devuelve `null` si no hay ninguna vigente. El llamador debe generar
 * MISSING_RATE (CRITICAL) — BR-033. **Nunca se paga 0 en silencio**, que es
 * exactamente el error que tienen los Excel actuales.
 */
export function resolveRate(
  rates: readonly RateInput[],
  options: {
    workDate: string
    rateType: RateType
    shift: Shift
    projectId: string | null
    operationId: string | null
  },
): RateInput | null {
  const vigentes = rates.filter((rate) => {
    if (rate.rateType !== options.rateType) return false
    if (rate.effectiveFrom > options.workDate) return false
    if (rate.effectiveTo !== null && rate.effectiveTo <= options.workDate) return false
    if (rate.shift !== 'ANY' && rate.shift !== options.shift) return false
    return true
  })

  const applicable = vigentes.filter((rate) => {
    if (rate.projectId !== null && rate.projectId !== options.projectId) return false
    if (rate.operationId !== null && rate.operationId !== options.operationId) return false
    return true
  })

  /*
   * Si el día no trae operación ni proyecto y aun así queda UNA sola tarifa
   * vigente, esa es. No hay nada que adivinar: es la única respuesta posible.
   *
   * Si quedan varias, NO se elige ninguna: dos tarifas distintas para el mismo
   * día es exactamente el caso en que adivinar cambia lo que alguien cobra.
   */
  if (applicable.length === 0) {
    const sinAmarrar = options.operationId === null && options.projectId === null
    if (sinAmarrar && vigentes.length === 1) return vigentes[0]!
    return null
  }

  return applicable.reduce((best, candidate) =>
    specificity(candidate) > specificity(best) ? candidate : best,
  )
}

function specificity(rate: RateInput): number {
  let score = 0
  if (rate.projectId !== null) score += 4
  if (rate.shift !== 'ANY') score += 2
  if (rate.operationId !== null) score += 1
  return score
}
