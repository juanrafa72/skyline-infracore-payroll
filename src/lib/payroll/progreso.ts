/**
 * Hasta dónde va la captura de una semana.
 *
 * Nace de una pregunta del negocio: «si uno va a empezar a tirar la nómina día
 * a día, pero no la va a pasar a aprobación hasta el final de la semana, ¿cómo
 * se maneja eso?».
 *
 * El sistema ya permite guardar cuantas veces se quiera. Lo que faltaba es que
 * se VEA en qué punto va: una semana a medias y una semana terminada se ven
 * exactamente igual, y esa confusión cuesta caro en las dos direcciones — o se
 * manda a aprobación sin el jueves y el viernes, o se deja quieta una semana
 * que ya estaba lista.
 *
 * La regla que hace todo lo demás sensato: **los días que no han llegado no
 * faltan**. Marcar el sábado un martes no tiene sentido, y contarlo como
 * pendiente convertiría el aviso en ruido que se aprende a ignorar.
 *
 * Puro: recibe el día de hoy como dato y no lee el reloj. Así se prueba un
 * martes lo que va a pasar un sábado.
 */

import { dayName } from './week'

export interface EntradaProgreso {
  /** Los siete días de la semana, en orden, como `2026-08-09`. */
  dias: readonly string[]
  /** Cuántas personas hay en la semana. */
  personas: number
  /**
   * Qué casillas ya tienen algo puesto: `workerId:fecha`. «No trabajó» cuenta
   * como registrado — es una respuesta, no un vacío.
   */
  registradas: ReadonlySet<string>
  /** Hoy, como `2026-08-12`. Entra como dato: el motor no lee el reloj. */
  hoy: string
}

export interface ProgresoSemana {
  /** Días de la semana que ya pasaron. Los que faltan por llegar no cuentan. */
  diasCorridos: readonly string[]
  /** Días ya corridos donde NADIE tiene nada puesto. */
  diasEnBlanco: readonly string[]
  /** Casillas que deberían estar llenas hoy: personas × días corridos. */
  casillas: number
  llenas: number
  vacias: number
  /** La semana ya pasó completa. */
  terminada: boolean
  /** Está todo lo que podía estar a la fecha. */
  alDia: boolean
  /** Cómo va, dicho para que lo entienda quien captura. */
  resumen: string
}

/** Los días de la semana que ya ocurrieron (incluido hoy). */
function corridos(dias: readonly string[], hoy: string): readonly string[] {
  return dias.filter((dia) => dia <= hoy)
}

/**
 * Cómo va la semana.
 *
 * Cuenta solo lo que ya pudo capturarse. Una semana futura —abierta por
 * adelantado— no tiene nada pendiente, y así lo dice.
 */
export function progresoDeLaSemana(entrada: EntradaProgreso): ProgresoSemana {
  const diasCorridos = corridos(entrada.dias, entrada.hoy)
  const terminada = entrada.dias.length > 0 && entrada.dias[entrada.dias.length - 1]! < entrada.hoy

  const casillas = diasCorridos.length * entrada.personas
  let llenas = 0
  const diasEnBlanco: string[] = []

  for (const dia of diasCorridos) {
    let enEsteDia = 0
    for (const clave of entrada.registradas) {
      if (clave.endsWith(`:${dia}`)) enEsteDia += 1
    }
    llenas += Math.min(enEsteDia, entrada.personas)
    if (enEsteDia === 0) diasEnBlanco.push(dia)
  }

  const vacias = Math.max(0, casillas - llenas)
  const alDia = casillas > 0 && vacias === 0

  return {
    diasCorridos,
    diasEnBlanco,
    casillas,
    llenas,
    vacias,
    terminada,
    alDia,
    resumen: resumenDe({
      personas: entrada.personas,
      diasCorridos,
      diasEnBlanco,
      vacias,
      terminada,
      alDia,
    }),
  }
}

/**
 * La frase que se muestra.
 *
 * Dice **qué hacer**, no un porcentaje. «Faltan 6 casillas» no le sirve a
 * nadie; «faltan el jueves y el viernes» sí.
 */
function resumenDe(datos: {
  personas: number
  diasCorridos: readonly string[]
  diasEnBlanco: readonly string[]
  vacias: number
  terminada: boolean
  alDia: boolean
}): string {
  if (datos.personas === 0) return 'Todavía no hay nadie en esta semana.'
  if (datos.diasCorridos.length === 0) {
    return 'Esta semana todavía no empieza. Se marca a medida que van pasando los días.'
  }
  if (datos.alDia) {
    return datos.terminada
      ? 'La semana está completa: los siete días tienen registro.'
      : `Vas al día: todo registrado hasta el ${dayName(datos.diasCorridos[datos.diasCorridos.length - 1]!)}.`
  }

  const cierre = datos.terminada
    ? 'La semana ya pasó, así que estos días no se van a llenar solos.'
    : 'Puedes seguir marcando; la semana se manda a aprobación cuando esté completa.'

  if (datos.diasEnBlanco.length > 0) {
    return `Falta registrar ${enumerar(datos.diasEnBlanco.map(dayName))}. ${cierre}`
  }

  return `${datos.vacias} casilla(s) sin registrar. ${cierre}`
}

/** «jueves y viernes», «martes, jueves y viernes». */
export function enumerar(cosas: readonly string[]): string {
  if (cosas.length === 0) return ''
  if (cosas.length === 1) return cosas[0]!
  return `${cosas.slice(0, -1).join(', ')} y ${cosas[cosas.length - 1]}`
}
