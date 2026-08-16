/**
 * Contra QUÉ se paga un renglón — BR-195.
 *
 * «5 días», «3 registros de producción», «4 días × $450.00». Lo mismo se lee en
 * el resumen antes de aprobar, en el centro de pagos y en el PDF que va a
 * contabilidad, así que la frase se escribe UNA vez: si cada pantalla la armara
 * por su cuenta, la orden diría una cosa y el soporte otra.
 *
 * Es texto para leer, nunca para calcular: el monto sale del motor.
 */
import { daysLabel } from '@/lib/payroll/estimate'

function money(value: string): string {
  return `$${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Días de una persona: «5 días», «5½ días» (dos medios son uno completo).
 *
 * `null` cuando no hay días marcados —pago por horas, por ejemplo—: mejor no
 * decir nada que escribir «0 días» al lado de un monto que no es cero.
 */
export function workerDetail(daysFull: number, daysHalf: number): string | null {
  if (daysFull === 0 && daysHalf === 0) return null
  const value = daysLabel(daysFull, daysHalf)
  return `${value} ${value === '1' ? 'día' : 'días'}`
}

/**
 * Contra qué se le paga a una cuadrilla.
 *
 * Depende de cómo cobre: «3 registros de producción» si es por pie
 * construido, «5 días × $800.00» si es un precio fijo por día. En el
 * desprendible tiene que leerse la cuenta que de verdad se hizo — decir
 * «registros de producción» en una cuadrilla que cobra por día haría buscar
 * una producción que no existe.
 */
export function crewDetail(
  count: number,
  billingMode: string = 'PRODUCTION',
  dailyRate?: string | null,
): string {
  if (billingMode === 'DAILY') {
    const dias = `${count} ${count === 1 ? 'día' : 'días'}`
    return dailyRate ? `${dias} × ${money(dailyRate)}` : dias
  }
  return `${count} ${count === 1 ? 'registro' : 'registros'} de producción`
}

/** Alquiler de un equipo: «4 días × $450.00». */
export function equipmentDetail(days: number, dailyCost: string): string {
  return `${days} ${days === 1 ? 'día' : 'días'} × ${money(dailyCost)}`
}
