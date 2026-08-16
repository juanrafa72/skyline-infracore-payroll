/**
 * Los cheques que nos pagan, y lo que nos descuentan de ellos.
 *
 * Rafael, 16/08: «Leo carga el valor del cheque que tiene en la base
 * (SharePoint), traído por una semana o varias y amarrado a una empresa;
 * después él digita lo que de verdad entró al banco manualmente y explica si
 * hay un descuento o varios y por qué».
 *
 * El asunto es la DIFERENCIA. Un cheque que dice $50.000 y del que entraron
 * $38.000 tiene $12.000 que alguien se quedó, y esos doce mil son de tres
 * clases muy distintas: retención que nos devuelven cuando acabe el proyecto,
 * descuento que nunca vuelve, o un error que hay que reclamar. Si el sistema
 * deja «cuadrar» la diferencia sin explicarla, la plata retenida se confunde
 * con plata perdida y nadie la reclama nunca.
 *
 * Puro y en centavos enteros. La fecha de hoy entra como dato: la antigüedad
 * de una retención se prueba sin esperar tres meses.
 */

import { type Cents, ZERO, add, subtract, toCents } from '@/lib/payroll/engine/money'

/** De qué es el descuento. Decide si la plata vuelve algún día. */
export type ClaseDescuento = 'RETENCION' | 'MATERIAL' | 'DANO' | 'ANTICIPO' | 'OTRO'

export const CLASE_DESCUENTO: Record<ClaseDescuento, string> = {
  RETENCION: 'Retención',
  MATERIAL: 'Material',
  DANO: 'Daño',
  ANTICIPO: 'Anticipo descontado',
  OTRO: 'Otro',
}

/** Qué significa cada clase, en una línea, para quien captura. */
export const AYUDA_DESCUENTO: Record<ClaseDescuento, string> = {
  RETENCION: 'La devuelven cuando termine el proyecto. Queda en Retenciones, con su antigüedad.',
  MATERIAL: 'Material que el cliente puso y nos cobra. No vuelve.',
  DANO: 'Daño que nos cobraron. No vuelve.',
  ANTICIPO: 'Plata que ya nos habían adelantado. No es pérdida: se está devolviendo.',
  OTRO: 'Cualquier otra cosa. Explícala en el motivo.',
}

/** Solo la retención vuelve. Lo demás ya no se recupera. */
export function vuelveAlgunDia(clase: ClaseDescuento): boolean {
  return clase === 'RETENCION'
}

export interface DescuentoDelCheque {
  clase: ClaseDescuento
  monto: string
  /** Por qué. Obligatorio: un descuento sin explicación no se puede reclamar. */
  motivo: string
}

export type Cuadre =
  /** Lo que entró más los descuentos da exactamente el valor del cheque. */
  | { estado: 'CUADRA' }
  /** Falta explicar plata: entró menos y los descuentos no lo cubren. */
  | { estado: 'FALTA_EXPLICAR'; monto: Cents; mensaje: string }
  /** Entró MÁS de lo esperado, o los descuentos suman de más. */
  | { estado: 'SOBRA'; monto: Cents; mensaje: string }

/**
 * ¿Cuadra el cheque?
 *
 * `esperado = entró + descuentos`. Cualquier otra cosa es una diferencia que
 * alguien tiene que explicar antes de dar el cheque por bueno.
 */
export function cuadrarCheque(entrada: {
  /** Lo que dice el soporte que debía entrar. */
  esperado: string
  /** Lo que de verdad entró al banco. */
  recibido: string
  descuentos: readonly DescuentoDelCheque[]
}): Cuadre {
  const esperado = toCents(entrada.esperado)
  const recibido = toCents(entrada.recibido)

  let descontado = ZERO
  for (const descuento of entrada.descuentos) descontado = add(descontado, toCents(descuento.monto))

  const explicado = add(recibido, descontado)
  const diferencia = subtract(esperado, explicado)

  if (diferencia === ZERO) return { estado: 'CUADRA' }

  if (diferencia > ZERO) {
    return {
      estado: 'FALTA_EXPLICAR',
      monto: diferencia,
      mensaje:
        'Faltan por explicar. Agrega el descuento que falta y di de qué es: si no queda escrito, esa plata se pierde de vista.',
    }
  }

  return {
    estado: 'SOBRA',
    monto: -diferencia as Cents,
    mensaje:
      'Entró más de lo esperado, o los descuentos suman de más. Revisa el valor del cheque y los montos.',
  }
}

export interface RetencionViva {
  /** Quién nos retuvo. */
  customerId: string
  customerName: string
  /** De qué obra. Sin proyecto no se sabe cuándo la devuelven. */
  projectId: string | null
  projectName: string | null
  monto: string
  /** Ya devuelta: deja de contar como viva. */
  devuelta: string
  /** Desde cuándo la tienen, `2026-05-01`. */
  desde: string
}

export interface GrupoRetencion {
  customerId: string
  customerName: string
  projectId: string | null
  projectName: string | null
  /** Lo que todavía tienen, en centavos. */
  vivo: Cents
  /** Cuántos descuentos componen ese saldo. */
  cuantos: number
  /** Días desde la retención MÁS VIEJA del grupo. */
  dias: number
  /** Los mismos días dichos en meses y días: «3 meses y 12 días». */
  antiguedad: string
}

/** Días entre dos fechas `YYYY-MM-DD`. Nunca negativo. */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`)
  const b = Date.parse(`${hasta}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

/**
 * La antigüedad dicha como la dice el negocio.
 *
 * «97 días» no le sirve a nadie para decidir si ya toca reclamar; «3 meses y
 * 7 días» sí. El mes se toma de 30 días a propósito: es una antigüedad para
 * conversar, no un cálculo de intereses.
 */
export function antiguedadEnPalabras(dias: number): string {
  if (dias <= 0) return 'hoy'
  if (dias < 30) return `${dias} día${dias === 1 ? '' : 's'}`

  const meses = Math.floor(dias / 30)
  const resto = dias % 30
  const parteMeses = `${meses} mes${meses === 1 ? '' : 'es'}`
  return resto === 0 ? parteMeses : `${parteMeses} y ${resto} día${resto === 1 ? '' : 's'}`
}

/**
 * Agrupa las retenciones por CLIENTE y PROYECTO.
 *
 * No basta con el cliente: el ejemplo del negocio es exactamente ese —a Bigham
 * en Dublin nos retienen diez mil hasta que termine la obra, y al mismo tiempo
 * a Bigham en Chiefland ya nos soltaron lo suyo—. Sumarlos daría un número que
 * no se puede reclamar en ninguna parte.
 *
 * Los grupos salen ordenados por antigüedad: primero lo que más lleva quieto.
 */
export function agruparRetenciones(
  filas: readonly RetencionViva[],
  hoy: string,
): GrupoRetencion[] {
  const grupos = new Map<string, GrupoRetencion>()

  for (const fila of filas) {
    const vivo = subtract(toCents(fila.monto), toCents(fila.devuelta))
    if (vivo <= ZERO) continue // ya la devolvieron: no es un saldo por reclamar

    const clave = `${fila.customerId}:${fila.projectId ?? 'sin-proyecto'}`
    const dias = diasEntre(fila.desde, hoy)
    const actual = grupos.get(clave)

    if (!actual) {
      grupos.set(clave, {
        customerId: fila.customerId,
        customerName: fila.customerName,
        projectId: fila.projectId,
        projectName: fila.projectName,
        vivo,
        cuantos: 1,
        dias,
        antiguedad: antiguedadEnPalabras(dias),
      })
      continue
    }

    actual.vivo = add(actual.vivo, vivo)
    actual.cuantos += 1
    if (dias > actual.dias) {
      actual.dias = dias
      actual.antiguedad = antiguedadEnPalabras(dias)
    }
  }

  return [...grupos.values()].sort((a, b) => b.dias - a.dias)
}

/** Lo que suman todos los grupos: cuánta plata nuestra está retenida hoy. */
export function totalRetenido(grupos: readonly GrupoRetencion[]): Cents {
  let total = ZERO
  for (const grupo of grupos) total = add(total, grupo.vivo)
  return total
}
