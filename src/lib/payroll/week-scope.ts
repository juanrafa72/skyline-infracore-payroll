import type { Prisma } from '@prisma/client'

/**
 * Qué semana es TRABAJO NUESTRO y cuál es archivo del Excel.
 *
 * De 140 semanas en la lista, 137 son archivo: sus días entraron por
 * importación (`sourceType: IMPORT`) y jamás generaron nómina, a propósito
 * (BR-153). Mostrarlas mezcladas obliga a bajar por 120 filas en $0.00 para
 * llegar a la semana que sí se está trabajando.
 *
 * La condición vive aquí, en un solo sitio, porque la usan la pantalla de
 * entrada (para elegir en qué semana pararse) y la lista de Nómina (para
 * decidir qué mostrar de una). Si cada una la escribiera aparte, una podría
 * considerar «con trabajo» lo que la otra manda al archivo.
 */

/** Una semana tiene trabajo nuestro si alguien marcó días o si ya se liquidó. */
export const CON_TRABAJO_NUESTRO: Prisma.PayrollWeekWhereInput = {
  OR: [
    { workEntries: { some: { sourceType: { not: 'IMPORT' }, isControlOnly: false } } },
    { payrolls: { some: {} } },
    { crewPayrolls: { some: {} } },
    { equipmentPayrolls: { some: {} } },
  ],
}

/**
 * ¿Esta semana es archivo del Excel?
 *
 * Para decidirlo sobre filas ya cargadas, sin volver a consultar. Un corte
 * fuera de calendario nunca es archivo: se abrió a mano para liquidar a
 * alguien.
 */
export function esArchivo(week: {
  isOffCycle: boolean
  payrolls: readonly unknown[]
  ownEntries: number
}): boolean {
  if (week.isOffCycle) return false
  return week.payrolls.length === 0 && week.ownEntries === 0
}
