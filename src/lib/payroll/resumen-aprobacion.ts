/**
 * El resumen que Leo revisa antes de mandarle la semana a Rafael.
 *
 * Lo pidió el negocio así: «es importante que Leo, cuando mande lo aprobado,
 * pueda ver un resumen de lo que está aprobando para darle el último visto
 * bueno, y ya llegue a mi parte de aprobación… documento resumen de todo con
 * su consecutivo único».
 *
 * Son dos cosas distintas y conviene no confundirlas:
 *
 * 1. **Antes de enviar**: un vistazo a lo que se va a mandar, para atajar el
 *    error mientras todavía se puede corregir sin devolver nada.
 * 2. **Al enviar**: el mismo resumen queda congelado con un consecutivo. Es el
 *    papel que Leo y Rafael pueden citar por número —«el RA-0007»— cuando
 *    hablen por teléfono, y contra el que se compara si algo cambió después.
 *
 * Puro y en centavos enteros: es dinero que alguien mira para decidir, y toda
 * cifra de dinero pasa por el motor.
 */

import { type Cents, ZERO, add, toCents } from './engine/money'

export interface RenglonResumen {
  /** Nombre congelado: la persona, la cuadrilla o el equipo. */
  nombre: string
  /** Lo que se le va a pagar, como texto con dos decimales. */
  neto: string
}

export interface BloqueResumen {
  titulo: string
  /** Cuántos renglones. Se muestra aunque el bloque venga vacío. */
  cuantos: number
  total: Cents
  renglones: readonly RenglonResumen[]
}

export interface ResumenAprobacion {
  personal: BloqueResumen
  equipos: BloqueResumen
  cuadrillas: BloqueResumen
  /** Suma de los tres. Es lo que Rafael va a aprobar. */
  total: Cents
  /** Cuántos pagables en total. Cero = no hay nada que mandar. */
  cuantos: number
}

function bloque(titulo: string, renglones: readonly RenglonResumen[]): BloqueResumen {
  /*
   * Se suma en centavos enteros, uno por uno.
   *
   * Sumar los textos con `Number` y redondear al final pierde centavos por el
   * camino: con 149 personas, esa diferencia es la que después no cuadra
   * contra el banco.
   */
  let total = ZERO
  for (const renglon of renglones) total = add(total, toCents(renglon.neto))

  return { titulo, cuantos: renglones.length, total, renglones }
}

/** Arma el resumen de lo que se va a enviar a aprobación. */
export function resumirParaAprobacion(entrada: {
  personal: readonly RenglonResumen[]
  equipos: readonly RenglonResumen[]
  cuadrillas: readonly RenglonResumen[]
}): ResumenAprobacion {
  const personal = bloque('Personal', entrada.personal)
  const equipos = bloque('Equipo rentado', entrada.equipos)
  const cuadrillas = bloque('Cuadrillas', entrada.cuadrillas)

  return {
    personal,
    equipos,
    cuadrillas,
    total: add(add(personal.total, equipos.total), cuadrillas.total),
    cuantos: personal.cuantos + equipos.cuantos + cuadrillas.cuantos,
  }
}

/**
 * Consecutivo del resumen: `RA-SKYLINE-2026-0007`.
 *
 * Lleva compañía y año adentro para que, viendo solo el número en un correo o
 * en una nota, se sepa de dónde salió sin abrir el sistema — igual que las
 * órdenes (`OD-`) y los reportes (`RP-`).
 */
export function formatSummaryNumber(
  companyCode: string,
  year: number,
  numero: number,
): string {
  return `RA-${companyCode}-${year}-${String(numero).padStart(4, '0')}`
}
