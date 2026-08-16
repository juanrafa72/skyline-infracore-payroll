/**
 * La empresa receptora recibe su propio soporte, sin que nadie lo configure.
 *
 * Rafael, 16/08: «si la empresa receptora tiene correo creado, que lo agregue
 * automáticamente, y de igual manera tenga el lápiz por si uno quiere quitarlo
 * o dejarlo o agregar otra persona».
 *
 * Automático **hasta que alguien opine**. Ese es todo el asunto: el sistema
 * pone lo obvio para que nadie tenga que acordarse, pero en el momento en que
 * una persona corrige el correo o lo quita, deja de mandar. Un automatismo que
 * insiste después de que le dijeron que no es peor que no tenerlo — devuelve
 * silenciosamente un correo que alguien quitó a propósito, y el desprendible
 * de una empresa termina en la bandeja equivocada.
 *
 * Puro: decide qué hacer, no lo hace. Así las tres reglas de arriba se prueban
 * sin base de datos.
 */

export interface ReceptoraParaCorreo {
  id: string
  name: string
  /** Con quién se habla allá. Si no hay, se usa el nombre de la empresa. */
  contactName: string | null
  /** El correo de HOY. Vacío o nulo = no hay a dónde mandar. */
  email: string | null
  /** El correo que tenía ANTES de este cambio. Nulo al crearla. */
  emailAnterior?: string | null
}

export interface DestinatarioExistente {
  id: string
  email: string
  active: boolean
}

export type DecisionAuto =
  /** No hay nada que hacer. */
  | { tipo: 'NADA'; porque: string }
  /** Agregar a la empresa receptora como destinatario de SUS órdenes. */
  | { tipo: 'CREAR'; name: string; email: string }
  /** El correo cambió y el destinatario todavía era el automático: se sigue. */
  | { tipo: 'ACTUALIZAR'; id: string; email: string }

/**
 * Qué hacer con el destinatario automático de una empresa receptora.
 *
 * `existente` es el destinatario que ya está atado a ESA empresa, si lo hay —
 * activo o desactivado. Su estado es lo que manda:
 *
 * - No hay ninguno → se crea. Es el caso de todos los días.
 * - Hay uno, desactivado → se respeta. Lo quitaron a propósito.
 * - Hay uno con el correo viejo → se actualiza: nadie lo había tocado.
 * - Hay uno con otro correo → se deja. Alguien lo corrigió con el lápiz.
 */
export function decidirAuto(
  receptora: ReceptoraParaCorreo,
  existente: DestinatarioExistente | null,
): DecisionAuto {
  const email = (receptora.email ?? '').trim().toLowerCase()
  if (!email) {
    return { tipo: 'NADA', porque: 'La empresa receptora no tiene correo.' }
  }

  if (!existente) {
    return {
      tipo: 'CREAR',
      // El nombre del contacto si lo hay: en la lista se lee mejor «Isaac
      // Ceballos» que repetir el nombre de la empresa que ya sale al lado.
      name: (receptora.contactName ?? '').trim() || receptora.name,
      email,
    }
  }

  if (!existente.active) {
    return { tipo: 'NADA', porque: 'Lo quitaron a propósito; no se vuelve a poner solo.' }
  }

  if (existente.email === email) {
    return { tipo: 'NADA', porque: 'Ya está puesto con ese mismo correo.' }
  }

  /*
   * ¿Seguía siendo el automático?
   *
   * Solo si lo que tiene es exactamente el correo anterior de la empresa. Si
   * dice otra cosa, alguien lo escribió a mano y esa decisión pesa más que
   * este automatismo.
   */
  const anterior = (receptora.emailAnterior ?? '').trim().toLowerCase()
  if (anterior && existente.email === anterior) {
    return { tipo: 'ACTUALIZAR', id: existente.id, email }
  }

  return { tipo: 'NADA', porque: 'Alguien lo cambió a mano; su decisión manda.' }
}
