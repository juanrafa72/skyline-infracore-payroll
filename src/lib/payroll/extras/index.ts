/**
 * Descuentos y adicionales de la semana.
 *
 * Lo que no es un día trabajado pero cambia lo que alguien recibe: el hotel, la
 * herramienta que se le prestó, el bono por terminar, el viático.
 *
 * Dos reglas mandan aquí:
 *
 * 1. **Toda línea lleva explicación.** Un monto sin motivo es plata que alguien
 *    va a tener que justificar meses después sin acordarse — BR-061, BR-071.
 *
 * 2. **Las recuperaciones de préstamo NO se capturan a mano.** Las genera el
 *    motor a partir del anticipo, para que el saldo del préstamo y el descuento
 *    nunca digan cosas distintas — BR-072. La base también lo impide.
 *
 * Este archivo es PURO: solo tipos y etiquetas. Lo importa también el
 * navegador, y sin esta separación arrastraría Prisma al paquete del cliente —
 * que es exactamente lo que rompió la compilación la primera vez.
 */

export type AdditionCategory =
  | 'BONUS'
  | 'REIMBURSEMENT'
  | 'TRAVEL'
  | 'PER_DIEM'
  | 'COMPLETION_BONUS'
  | 'EMERGENCY'
  | 'MANUAL_ADJUSTMENT'
  | 'OTHER'

/** Las que una persona puede capturar. Las dos de recuperación no están. */
export type ManualDeductionCategory =
  | 'EQUIPMENT'
  | 'HOTEL'
  | 'VEHICLE'
  | 'LOAN'
  | 'DAMAGE'
  | 'PPE'
  | 'RENT'
  | 'CASH_ADVANCE'
  | 'OTHER'

export const ADICIONAL: Record<AdditionCategory, string> = {
  BONUS: 'Bono',
  COMPLETION_BONUS: 'Bono por terminar',
  TRAVEL: 'Viaje',
  PER_DIEM: 'Viáticos',
  REIMBURSEMENT: 'Reembolso',
  EMERGENCY: 'Emergencia',
  MANUAL_ADJUSTMENT: 'Ajuste manual',
  OTHER: 'Otro',
}

export const DESCUENTO: Record<ManualDeductionCategory, string> = {
  HOTEL: 'Hotel',
  EQUIPMENT: 'Equipo',
  VEHICLE: 'Vehículo',
  PPE: 'Dotación',
  RENT: 'Arriendo',
  DAMAGE: 'Daño',
  LOAN: 'Préstamo suelto',
  CASH_ADVANCE: 'Adelanto en efectivo',
  OTHER: 'Otro',
}


/** Cómo se ve una línea ya anotada, para pintarla. */
export interface ExtraRow {
  id: string
  kind: 'ADDITION' | 'DEDUCTION'
  workerId: string
  workerName: string
  categoryLabel: string
  amount: string
  description: string
  workDate: string | null
  /** `false` cuando lo generó el motor: no se puede quitar desde aquí. */
  removable: boolean
  locked: boolean
}
