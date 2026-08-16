/**
 * Que dos personas capturando la misma semana no se pisen.
 *
 * La rejilla manda los SIETE días de cada persona cada vez que se guarda —así
 * es como funciona un formulario— y eso tiene una consecuencia que no se ve:
 * si Leo abre la semana el lunes por la mañana, Rafael marca el martes a
 * mediodía, y Leo guarda a las 5 de la tarde con su pantalla vieja, el martes
 * de Rafael desaparece sin que nadie se entere.
 *
 * Con una sola persona capturando no pasa nunca. Con dos, es cuestión de
 * tiempo — y lo que se pierde es un día de trabajo de alguien.
 *
 * La solución que pidió el negocio: avisar, y si igual va a cambiar lo que
 * otro trabajó, **pedir una nota** que quede registrada con su nombre.
 *
 * Puro: la decisión se prueba sin base de datos.
 */

export interface EstadoDeLaSemana {
  /** Cuándo se tocó por última vez. Nulo si nadie ha guardado nada. */
  tocadaEn: Date | null
  /** Quién la tocó. Nulo cuando el dato viene del Excel o de antes. */
  tocadaPor: string | null
  /** Su nombre, para poder decírselo a quien está guardando. */
  tocadaPorNombre: string | null
}

export type VeredictoGuardado =
  /** Nadie más la tocó: se guarda sin más. */
  | { tipo: 'LIBRE' }
  /** La tocó otra persona después de que se abrió: hay que avisar. */
  | { tipo: 'PISARIA'; quien: string; mensaje: string }

/**
 * ¿Guardar ahora pisaría el trabajo de alguien más?
 *
 * Solo cuando **otra persona** guardó **después** de que esta pantalla se
 * abrió. Que uno mismo haya guardado dos veces no es conflicto: es el caso
 * normal de ir marcando la semana día a día, y frenarlo haría inservible el
 * guardado parcial.
 */
export function evaluarGuardado(
  estado: EstadoDeLaSemana,
  input: {
    /** Cuándo se abrió la pantalla que está guardando. */
    abiertaEn: Date | null
    /** Quién está guardando ahora. */
    usuarioId: string
  },
): VeredictoGuardado {
  // Nadie la ha tocado, o no se sabe cuándo se abrió: no hay con qué comparar.
  if (!estado.tocadaEn || !input.abiertaEn) return { tipo: 'LIBRE' }

  // Uno mismo: marcar lunes y volver el miércoles es lo esperado.
  if (estado.tocadaPor === input.usuarioId) return { tipo: 'LIBRE' }

  // Se tocó antes de abrir esta pantalla: lo que hay en pantalla ya lo incluye.
  if (estado.tocadaEn <= input.abiertaEn) return { tipo: 'LIBRE' }

  const quien = estado.tocadaPorNombre ?? 'otra persona'
  return {
    tipo: 'PISARIA',
    quien,
    mensaje:
      `${quien} guardó cambios en esta semana mientras la tenías abierta. ` +
      'Si guardas ahora, lo que hizo se reemplaza por lo que tienes en pantalla. ' +
      'Refresca para ver lo suyo, o escribe abajo por qué vas a cambiarlo.',
  }
}

/** ¿La nota alcanza para dejar constancia? */
export function notaSuficiente(nota: string | null | undefined): boolean {
  return (nota ?? '').trim().length >= 5
}

export const FALTA_NOTA =
  'Escribe por qué vas a cambiar lo que hizo la otra persona. Queda registrado con tu nombre.'

/**
 * La marca de cuándo se abrió la pantalla, que viaja en el formulario.
 *
 * Llega como texto y lo escribe el navegador, así que puede venir vacía o
 * rota. Una marca que no se entiende NO bloquea el guardado: se trata como
 * «no se sabe» y se deja pasar. Frenar por un campo ilegible convertiría un
 * detalle técnico en una pared para quien solo quiere marcar días.
 */
export function fechaDeApertura(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const fecha = new Date(raw)
  return Number.isNaN(fecha.getTime()) ? null : fecha
}
