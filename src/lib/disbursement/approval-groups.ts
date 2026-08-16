import { type Cents, ZERO, add, toCents, toDecimalString } from '@/lib/payroll/engine/money'

/**
 * Agrupar lo que se va a aprobar por la empresa que paga.
 *
 * Es el orden en que tesorería mueve el dinero: una transferencia por empresa
 * receptora. El negocio lo pidió con este ejemplo — a Juan Rafael y a Juan
 * José les paga FORZO y a Federico, Quintero: los dos de FORZO tienen que
 * quedar juntos, con su total, ANTES de aprobar. En una lista plana hay que
 * sumar de cabeza para saber cuánto va a cada empresa, que es justo la cifra
 * que se transfiere.
 *
 * Puro: la pantalla lo usa para pintar y la prueba lo verifica sin navegador.
 */

/** Lo mínimo que necesita una fila para poder agruparse por quién le paga. */
export interface Agrupable {
  id: string
  recipientId: string | null
  recipientName: string | null
}

export interface GrupoReceptora<T> {
  /** `null` de receptora colapsa a esta llave: todos los sin asignar van juntos. */
  key: string
  name: string
  rows: T[]
  /** Suma de TODAS las filas del grupo. */
  total: string
  /** Suma de las marcadas — lo que de verdad se va a aprobar. */
  selectedTotal: string
}

export const SIN_RECEPTORA = '__sin__'

/**
 * Agrupa por receptora y suma cada grupo en CENTAVOS ENTEROS.
 *
 * Sumar pesos con decimales en el navegador puede dar un centavo distinto al
 * del servidor, y ese centavo es una diferencia sin explicar — regla 1.
 */
export function agruparPorReceptora<T extends Agrupable>(
  rows: readonly T[],
  amountOf: (row: T) => string,
  selected: ReadonlySet<string>,
): Array<GrupoReceptora<T>> {
  const grupos = new Map<
    string,
    { key: string; name: string; rows: T[]; total: Cents; selectedTotal: Cents }
  >()

  for (const row of rows) {
    const key = row.recipientId ?? SIN_RECEPTORA
    const grupo = grupos.get(key) ?? {
      key,
      name: row.recipientName ?? 'Sin empresa receptora',
      rows: [],
      total: ZERO,
      selectedTotal: ZERO,
    }
    grupo.rows.push(row)
    const amount = toCents(amountOf(row))
    grupo.total = add(grupo.total, amount)
    if (selected.has(row.id)) grupo.selectedTotal = add(grupo.selectedTotal, amount)
    grupos.set(key, grupo)
  }

  // Los que aún no tienen a quién pagarle van de primeros: son los que frenan
  // la aprobación, y dejarlos al final los esconde.
  return [...grupos.values()]
    .sort((a, b) => {
      if (a.key === SIN_RECEPTORA) return -1
      if (b.key === SIN_RECEPTORA) return 1
      return a.name.localeCompare(b.name, 'es')
    })
    .map((grupo) => ({
      key: grupo.key,
      name: grupo.name,
      rows: grupo.rows,
      total: toDecimalString(grupo.total),
      selectedTotal: toDecimalString(grupo.selectedTotal),
    }))
}
