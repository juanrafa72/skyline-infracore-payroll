/**
 * Cómo se le dice a cada cosa en pantalla.
 *
 * Los códigos internos (PENDING_APPROVAL, FULL_DAY, ZELLE…) nunca se le muestran
 * a una persona. Si aparece uno en pantalla, es un error.
 */

export const ESTADO_NOMINA: Record<string, string> = {
  DRAFT: 'Sin terminar',
  PREPARED: 'Calculada',
  PENDING_APPROVAL: 'Esperando aprobación',
  REJECTED: 'Devuelta con comentarios',
  APPROVED: 'Aprobada',
  READY_TO_PAY: 'Lista para pagar',
  PAYMENT_IN_PROCESS: 'Pagando',
  PAID: 'Pagada',
  RECONCILED: 'Conciliada',
  CLOSED: 'Cerrada',
  IMPORTED_HISTORICAL: 'Histórico del Excel',
}

export const TIPO_PERSONA: Record<string, string> = {
  EMPLOYEE: 'Empleado',
  CONTRACTOR_MEMBER: 'De contratista',
  ADMINISTRATIVE: 'Administrativo',
  SUBCONTRACTOR: 'Subcontratista',
}

export const FORMA_PAGO: Record<string, string> = {
  DAILY_RATE: 'Por día',
  HOURLY: 'Por hora',
  FIXED_WEEKLY: 'Fijo semanal',
  PRODUCTION: 'Por producción',
  PIECE_RATE: 'Por pieza',
  PERCENTAGE: 'Porcentaje',
  CONTRACTOR_SETTLEMENT: 'Liquidación',
  MANUAL: 'Manual',
}

export const METODO_PAGO: Record<string, string> = {
  ZELLE: 'Zelle',
  ACH: 'Transferencia ACH',
  WIRE: 'Transferencia',
  CHECK: 'Cheque',
  CASH: 'Efectivo',
  OTHER: 'Otro',
}

export const TIPO_TARIFA: Record<string, string> = {
  DAILY: 'Por día',
  HOURLY: 'Por hora',
  WEEKLY: 'Semanal',
  PIECE: 'Por pieza',
  PERCENTAGE: 'Porcentaje',
}

export const ESTADO_ORDEN: Record<string, string> = {
  PENDING_PAYMENT: 'Pendiente de pago',
  PARTIALLY_PAID: 'Pagada en parte',
  PAID: 'Pagada',
  CANCELLED: 'Anulada',
}

export const TIPO_DOCUMENTO: Record<string, string> = {
  PAYMENT_PROOF: 'Comprobante bancario',
  ORDER_PDF: 'Desprendible',
  OTHER: 'Otro',
}

export const TURNO: Record<string, string> = {
  DAY: 'Día',
  NIGHT: 'Noche',
  ANY: 'Cualquiera',
}

/** Traduce, y si no conoce el código lo devuelve tal cual para que se note. */
export function label(dictionary: Record<string, string>, code: string): string {
  return dictionary[code] ?? code
}

/**
 * Unidades de producción, en español.
 *
 * La base guarda el código (`FOOT`) y cada registro trae además su etiqueta
 * libre (`unitLabel`: «pies», «Aerial Fiber»). En pantalla se leía «10,000
 * foot» porque se mostraba el código en minúscula.
 */
export const UNIDAD_MEDIDA: Record<string, string> = {
  FOOT: 'pies',
  METER: 'metros',
  UNIT: 'unidades',
  HOUR: 'horas',
  DAY: 'días',
}
