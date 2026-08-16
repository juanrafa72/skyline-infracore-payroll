/**
 * Qué va en ESTA semana: equipos y cuadrillas.
 *
 * Antes la semana ofrecía todas las máquinas activas de la compañía, siempre.
 * Con ocho se aguanta; con cincuenta, quien marca los días recorre una lista
 * donde la mayoría no estuvo en obra — y marcar el equipo equivocado cuesta
 * plata de verdad, porque al rentado se le paga a un proveedor.
 *
 * Es la misma idea que la lista de gente de la semana: se arma escogiendo qué
 * trabajó. La diferencia es que aquí hay historia previa, y por eso lo primero
 * de abajo importa más de lo que parece.
 *
 * Puro: decide, no consulta.
 */

export interface EnLaSemana {
  /** Equipo o cuadrilla, según quién pregunte. */
  id: string
  /** Alguien lo puso en la lista de esta semana. */
  escogido: boolean
  /** Tiene días marcados en la semana. */
  diasMarcados: number
  /** Ya tiene liquidación calculada. */
  tieneLiquidacion: boolean
}

/**
 * ¿Está en la semana?
 *
 * Escogido a mano **o** con trabajo encima. Lo segundo no es un detalle: las
 * semanas que ya existían no tienen a nadie escogido, y sin esta regla el
 * negocio abriría una semana vieja y vería la lista vacía —creyendo que se
 * perdieron los días que marcó—. Lo que tiene días, está.
 */
export function estaEnLaSemana(equipo: EnLaSemana): boolean {
  return equipo.escogido || equipo.diasMarcados > 0 || equipo.tieneLiquidacion
}

export type VeredictoQuitar =
  | { puede: true }
  | { puede: false; porque: string }

/**
 * ¿Se puede sacar de la semana?
 *
 * No mientras tenga trabajo encima. Sacarlo borraría días marcados o dejaría
 * una liquidación apuntando a un equipo que ya no está en la semana, y esa
 * liquidación es plata que alguien va a transferir. Primero se le quitan los
 * días —o se devuelve la liquidación—, que son actos conscientes y con rastro.
 */
export function puedeSacarse(equipo: EnLaSemana): VeredictoQuitar {
  if (equipo.tieneLiquidacion) {
    return {
      puede: false,
      porque:
        'Ya tiene liquidación calculada en esta semana. Si de verdad no estuvo, empieza la semana de cero o devuelve la liquidación.',
    }
  }
  if (equipo.diasMarcados > 0) {
    return {
      puede: false,
      porque: `Tiene ${equipo.diasMarcados} día(s) marcado(s) en esta semana. Quítale los días primero: sacarlo así los borraría sin dejar rastro.`,
    }
  }
  return { puede: true }
}

/** Las pestañas de la semana, en el orden en que el negocio las mira. */
export type PestanaEquipos = 'RENTED' | 'OWNED' | 'TODOS'

export const PESTANAS: ReadonlyArray<{ value: PestanaEquipos; label: string; ayuda: string }> = [
  {
    value: 'RENTED',
    label: 'Rentados',
    ayuda: 'Los de esta semana que se le pagan a un proveedor.',
  },
  {
    value: 'OWNED',
    label: 'Propios',
    ayuda: 'Los de esta semana que son nuestros: dejan constancia de dónde estuvieron.',
  },
  {
    value: 'TODOS',
    label: 'Todos',
    ayuda: 'El catálogo completo. Aquí se agregan o se sacan de la semana.',
  },
]
