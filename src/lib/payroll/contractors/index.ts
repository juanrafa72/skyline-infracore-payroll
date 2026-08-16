import {
  type Cents,
  ZERO,
  abs,
  add,
  isZero,
  subtract,
  toCents,
  toDecimalString,
  unitPriceTotal,
} from '@/lib/payroll/engine/money'

/**
 * Lo que se le paga a un contratista por una semana, y si eso cuadra.
 *
 * El negocio, con el ejemplo de Rafael: **Hugo** trabajó el proyecto X a
 * **$0.30 por pie**. Construyó **10.000 pies** → se le deben **$3.000**. Hugo
 * tiene gente a cargo (Francisco, Juan, Eduardo), cada uno con la tarifa que
 * Hugo pactó. Nosotros le pagamos a HUGO un solo cheque (BR-242) y él le paga
 * a los suyos; pero llevamos el desglose para poder **conciliar** contra lo que
 * dice la fuente externa (hoy SharePoint).
 *
 * Puro: sin base de datos, sin reloj. La aritmética que decide cuánta plata
 * sale se prueba sola.
 */

/** Un renglón de producción: tantas unidades a tal precio. */
export interface ProductionLine {
  /** Pies construidos, unidades instaladas, lo que sea que se mide. */
  quantity: string
  /** Precio por unidad. Hasta 4 decimales: $0.3025 el pie es legítimo. */
  price: string
  unitLabel?: string
  projectName?: string | null
}

/** Alguien del equipo del contratista, o el contratista mismo. */
export interface MemberLine {
  name: string
  /** Lo pactado con esa persona. */
  rateAmount: string
  /** Cuántas unidades de esa tarifa: 1 semana, 5 días, 3.000 pies. */
  quantity: string
  /** WEEK, DAY, FOOT… solo para mostrar; no cambia la cuenta. */
  rateUnit?: string
  /** El contratista se lleva su propio renglón: su parte también suma. */
  isContractor?: boolean
}

export interface ContractorWeekInput {
  /** Producción de la semana. Puede venir de varios registros. */
  production: readonly ProductionLine[]
  /** Cómo se reparte por dentro. Vacío = todavía no se ha detallado. */
  members: readonly MemberLine[]
  /**
   * Lo que la fuente externa dice que se le debe. Nulo = sin conciliar.
   * Se teclea: Microsoft bloquea la extracción de esa base por etiqueta de
   * confidencialidad, así que el sistema no puede leerla solo.
   */
  expectedTotal?: string | null
}

export interface ContractorWeekResult {
  /** Σ producción = lo que le pagamos al contratista. */
  productionTotal: Cents
  /** Σ de los renglones de su gente (sin la parte del contratista). */
  membersTotal: Cents
  /** La parte del propio contratista, según el desglose. */
  contractorShare: Cents
  /** membersTotal + contractorShare: lo que el desglose dice que suma. */
  breakdownTotal: Cents
  /** Lo que dice la fuente externa, si se tecleó. */
  expectedTotal: Cents | null
  /**
   * Diferencia entre lo esperado y lo calculado. Nulo si no hay con qué
   * comparar. Positivo = la fuente dice MÁS de lo que calculamos.
   */
  difference: Cents | null
  /** Estado de la conciliación, para pintarlo sin repetir la lógica. */
  status: ReconcileStatus
  /** Qué decirle al usuario, en palabras del negocio. */
  message: string
}

export type ReconcileStatus =
  /** No se ha tecleado lo que dice la fuente. */
  | 'SIN_CONCILIAR'
  /** Cuadra exacto. */
  | 'CUADRA'
  /** Hay diferencia entre lo esperado y lo calculado. */
  | 'DIFERENCIA'
  /** Se tecleó lo esperado pero no hay desglose con qué compararlo. */
  | 'SIN_DESGLOSE'

/**
 * La cuenta completa de la semana de un contratista.
 *
 * Nada se "cuadra" en silencio: si el desglose no da lo que dice la fuente, la
 * diferencia se calcula y se muestra — regla 10. Prohibido esconderla.
 */
export function calculateContractorWeek(input: ContractorWeekInput): ContractorWeekResult {
  const productionTotal = input.production.reduce<Cents>(
    (total, line) => add(total, unitPriceTotal(line.quantity, line.price)),
    ZERO,
  )

  let membersTotal = ZERO
  let contractorShare = ZERO
  for (const member of input.members) {
    const amount = memberAmount(member)
    if (member.isContractor) contractorShare = add(contractorShare, amount)
    else membersTotal = add(membersTotal, amount)
  }
  const breakdownTotal = add(membersTotal, contractorShare)

  const expectedTotal =
    input.expectedTotal !== null && input.expectedTotal !== undefined && input.expectedTotal !== ''
      ? toCents(input.expectedTotal)
      : null

  const { status, difference, message } = reconcile({
    expectedTotal,
    breakdownTotal,
    productionTotal,
    hasMembers: input.members.length > 0,
  })

  return {
    productionTotal,
    membersTotal,
    contractorShare,
    breakdownTotal,
    expectedTotal,
    difference,
    status,
    message,
  }
}

/** Lo que le toca a un renglón del desglose: tarifa × cantidad. */
export function memberAmount(member: MemberLine): Cents {
  return unitPriceTotal(member.quantity, member.rateAmount)
}

function reconcile(args: {
  expectedTotal: Cents | null
  breakdownTotal: Cents
  productionTotal: Cents
  hasMembers: boolean
}): { status: ReconcileStatus; difference: Cents | null; message: string } {
  const { expectedTotal, breakdownTotal, productionTotal, hasMembers } = args

  if (expectedTotal === null) {
    return {
      status: 'SIN_CONCILIAR',
      difference: null,
      message:
        'Escribe lo que dice SharePoint para esta semana y el sistema te dice si cuadra ' +
        'con lo calculado.',
    }
  }

  if (!hasMembers) {
    // Sin desglose se compara contra la producción: es lo único que hay.
    const diff = subtract(expectedTotal, productionTotal)
    if (isZero(diff)) {
      return {
        status: 'CUADRA',
        difference: diff,
        message: `Cuadra: la producción da exactamente $${toDecimalString(expectedTotal)}.`,
      }
    }
    return {
      status: 'SIN_DESGLOSE',
      difference: diff,
      message:
        `La fuente dice $${toDecimalString(expectedTotal)} y la producción da ` +
        `$${toDecimalString(productionTotal)} — ${describeDifference(diff)}. ` +
        'Agrega el desglose de la gente del contratista para ver de dónde sale.',
    }
  }

  const diff = subtract(expectedTotal, breakdownTotal)
  if (isZero(diff)) {
    return {
      status: 'CUADRA',
      difference: diff,
      message: `Cuadra: el desglose suma exactamente $${toDecimalString(expectedTotal)}.`,
    }
  }

  return {
    status: 'DIFERENCIA',
    difference: diff,
    message:
      `La fuente dice $${toDecimalString(expectedTotal)} y el desglose suma ` +
      `$${toDecimalString(breakdownTotal)} — ${describeDifference(diff)}. ` +
      'Revisa las tarifas o si falta alguien en la lista.',
  }
}

/** «faltan $250.00» / «sobran $80.00», en vez de un número con signo. */
export function describeDifference(difference: Cents): string {
  if (isZero(difference)) return 'sin diferencia'
  const magnitude = toDecimalString(abs(difference))
  return difference > ZERO ? `faltan $${magnitude}` : `sobran $${magnitude}`
}

export const RECONCILE_TONE: Record<ReconcileStatus, 'good' | 'warning' | 'info'> = {
  CUADRA: 'good',
  DIFERENCIA: 'warning',
  SIN_DESGLOSE: 'warning',
  SIN_CONCILIAR: 'info',
}

export const RECONCILE_LABEL: Record<ReconcileStatus, string> = {
  CUADRA: 'Cuadra',
  DIFERENCIA: 'No cuadra',
  SIN_DESGLOSE: 'Falta el desglose',
  SIN_CONCILIAR: 'Sin conciliar',
}

/** Unidades en que se pacta una tarifa. Solo cambian la etiqueta. */
export const UNIDAD_TARIFA: Record<string, string> = {
  WEEK: 'por semana',
  DAY: 'por día',
  FOOT: 'por pie',
  UNIT: 'por unidad',
  LUMP: 'valor fijo',
}
