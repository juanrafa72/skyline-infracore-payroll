import { type Cents, ZERO, add, toCents, toDecimalString } from '@/lib/payroll/engine/money'

/**
 * El histórico de todo lo que se ha pagado: a quién, cuánto, cuándo y contra
 * qué. Aquí van los TOTALES, que son pura aritmética; las consultas viven en
 * `./history-service.ts`.
 *
 * El negocio lo pidió así: «manejar la trazabilidad de todo lo que se ha
 * pagado, para tener un tablero de control donde ver qué se ha pagado, a quién
 * se ha pagado y cómo».
 *
 * Los datos salen de los snapshots de las órdenes (BR-247, BR-248), no de
 * consultas vivas: si mañana cambia el nombre de una empresa receptora, el
 * histórico tiene que seguir diciendo lo que decía el día del pago.
 */

export interface FiltroHistorico {
  desde?: string | null
  hasta?: string | null
  /** Empresa receptora concreta. */
  recipientId?: string | null
  /** WORKER · CREW · EQUIPMENT, o todos. */
  kind?: 'WORKER' | 'CREW' | 'EQUIPMENT' | null
  /** Busca por nombre de quien recibió o del beneficiario. */
  q?: string | null
}

export interface PagoHistorico {
  orderId: string
  orderNumber: string
  recipientName: string
  recipientTaxId: string | null
  weekLabel: string
  periodStart: string
  periodEnd: string
  status: string
  totalAmount: string
  amountPaid: string
  paymentDate: string | null
  method: string | null
  bankName: string | null
  reference: string | null
  paidByName: string | null
  approvedByName: string | null
  itemCount: number
  /** Qué llevaba dentro, para poder mirar sin abrir la orden. */
  items: Array<{
    id: string
    name: string
    crewLabel: string | null
    detail: string | null
    amount: string
    kind: 'WORKER' | 'CREW' | 'EQUIPMENT'
  }>
}

export interface ResumenHistorico {
  /** Lo que ya salió del banco. */
  pagado: string
  /** Aprobado y esperando transferencia. */
  pendiente: string
  ordenesPagadas: number
  ordenesPendientes: number
  /** A cuántas empresas receptoras distintas se les ha pagado. */
  receptoras: number
  porTipo: { personas: string; cuadrillas: string; equipos: string }
}

/** Los totales del período, en centavos enteros. */
export function resumirHistorico(filas: readonly PagoHistorico[]): ResumenHistorico {
  let pagado = ZERO
  let pendiente = ZERO
  let personas = ZERO
  let cuadrillas = ZERO
  let equipos = ZERO
  let ordenesPagadas = 0
  let ordenesPendientes = 0
  const receptoras = new Set<string>()

  for (const fila of filas) {
    receptoras.add(fila.recipientName)

    const salido = toCents(fila.amountPaid)
    const total = toCents(fila.totalAmount)
    pagado = add(pagado, salido)

    if (fila.status === 'PAID') ordenesPagadas += 1
    else if (fila.status !== 'CANCELLED') {
      ordenesPendientes += 1
      // Lo que falta por salir de esta orden, no su total: una orden pagada a
      // medias ya movió parte del dinero.
      pendiente = add(pendiente, (total - salido) as Cents)
    }

    for (const item of fila.items) {
      const monto = toCents(item.amount)
      if (item.kind === 'WORKER') personas = add(personas, monto)
      else if (item.kind === 'CREW') cuadrillas = add(cuadrillas, monto)
      else equipos = add(equipos, monto)
    }
  }

  return {
    pagado: toDecimalString(pagado),
    pendiente: toDecimalString(pendiente),
    ordenesPagadas,
    ordenesPendientes,
    receptoras: receptoras.size,
    porTipo: {
      personas: toDecimalString(personas),
      cuadrillas: toDecimalString(cuadrillas),
      equipos: toDecimalString(equipos),
    },
  }
}

export interface TotalPorReceptora {
  name: string
  taxId: string | null
  ordenes: number
  pagado: string
  pendiente: string
}

/** Cuánto se le ha pagado a cada empresa receptora — «a quién se ha pagado». */
export function totalesPorReceptora(filas: readonly PagoHistorico[]): TotalPorReceptora[] {
  const mapa = new Map<
    string,
    { name: string; taxId: string | null; ordenes: number; pagado: Cents; pendiente: Cents }
  >()

  for (const fila of filas) {
    const actual = mapa.get(fila.recipientName) ?? {
      name: fila.recipientName,
      taxId: fila.recipientTaxId,
      ordenes: 0,
      pagado: ZERO,
      pendiente: ZERO,
    }
    actual.ordenes += 1
    actual.pagado = add(actual.pagado, toCents(fila.amountPaid))
    if (fila.status !== 'PAID' && fila.status !== 'CANCELLED') {
      actual.pendiente = add(
        actual.pendiente,
        (toCents(fila.totalAmount) - toCents(fila.amountPaid)) as Cents,
      )
    }
    mapa.set(fila.recipientName, actual)
  }

  return [...mapa.values()]
    .map((row) => ({
      name: row.name,
      taxId: row.taxId,
      ordenes: row.ordenes,
      pagado: toDecimalString(row.pagado),
      pendiente: toDecimalString(row.pendiente),
    }))
    .sort((a, b) => Number(b.pagado) - Number(a.pagado))
}

/** Filtra por tipo de pagable y por texto, sobre los renglones ya cargados. */
export function aplicarFiltros(
  filas: readonly PagoHistorico[],
  filtro: FiltroHistorico,
): PagoHistorico[] {
  /*
   * Estos dos filtros NO se hacen en SQL a propósito: una orden mixta lleva
   * personas, cuadrillas y equipos a la vez, así que filtrar en la consulta
   * devolvería la orden entera o ninguna, nunca los renglones que interesan.
   */
  return filas
    .filter((fila) => !filtro.kind || fila.items.some((item) => item.kind === filtro.kind))
    .filter((fila) => {
      if (!filtro.q) return true
      const texto = filtro.q.toLowerCase()
      return (
        fila.recipientName.toLowerCase().includes(texto) ||
        fila.orderNumber.toLowerCase().includes(texto) ||
        fila.items.some((item) => item.name.toLowerCase().includes(texto))
      )
    })
}

export const MEDIO_PAGO: Record<string, string> = {
  ACH: 'Transferencia ACH',
  WIRE: 'Transferencia bancaria',
  CHECK: 'Cheque',
  CASH: 'Efectivo',
  ZELLE: 'Zelle',
  OTHER: 'Otro',
}

export const ESTADO_ORDEN: Record<string, string> = {
  PENDING_PAYMENT: 'Esperando pago',
  PARTIALLY_PAID: 'Pagada a medias',
  PAID: 'Pagada',
  CANCELLED: 'Anulada',
}
