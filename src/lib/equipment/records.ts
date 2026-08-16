/**
 * La hoja de vida de un equipo, y cuándo avisar.
 *
 * El negocio lo pidió así: tener identificada cada máquina —seguros, títulos,
 * cambios de aceite— y que el sistema **avise antes** de que se venza un
 * seguro, no después.
 *
 * Puro: recibe la fecha de hoy como dato, nunca la lee del reloj. Una regla
 * que consulta el reloj por su cuenta no se puede probar (el resultado cambia
 * mañana) y en pruebas hay que esperar a que pase el tiempo real.
 */

export type RecordKind =
  | 'INSURANCE'
  | 'TITLE'
  | 'REGISTRATION'
  | 'INSPECTION'
  | 'MAINTENANCE'
  | 'WARRANTY'
  | 'OTHER'

export const TIPO_DOCUMENTO: Record<RecordKind, string> = {
  INSURANCE: 'Seguro',
  TITLE: 'Título de propiedad',
  REGISTRATION: 'Matrícula',
  INSPECTION: 'Revisión técnica',
  MAINTENANCE: 'Mantenimiento',
  WARRANTY: 'Garantía',
  OTHER: 'Otro',
}

/** Cuánta anticipación tiene sentido por tipo. Se puede cambiar por documento. */
export const AVISO_POR_DEFECTO: Record<RecordKind, number> = {
  INSURANCE: 30,
  TITLE: 0,
  REGISTRATION: 30,
  INSPECTION: 21,
  MAINTENANCE: 7,
  WARRANTY: 15,
  OTHER: 15,
}

export type EstadoVencimiento =
  /** Ya se venció: el equipo está trabajando sin cobertura. */
  | 'VENCIDO'
  /** Se vence dentro del plazo de aviso. */
  | 'POR_VENCER'
  /** Vigente y todavía lejos. */
  | 'VIGENTE'
  /** No vence (un título) o no se sabe. NO es lo mismo que vencido. */
  | 'SIN_VENCIMIENTO'

export interface DocumentoEquipo {
  kind: RecordKind
  expiresAt: string | null
  alertDaysBefore: number
  active: boolean
}

export interface EstadoDocumento {
  estado: EstadoVencimiento
  /** Días que faltan. Negativo = días que lleva vencido. Nulo si no vence. */
  diasRestantes: number | null
  /** Qué decirle al usuario, en palabras del negocio. */
  mensaje: string
}

/** Días enteros entre dos fechas ISO, sin importar husos horarios. */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(
    Number(desde.slice(0, 4)),
    Number(desde.slice(5, 7)) - 1,
    Number(desde.slice(8, 10)),
  )
  const b = Date.UTC(
    Number(hasta.slice(0, 4)),
    Number(hasta.slice(5, 7)) - 1,
    Number(hasta.slice(8, 10)),
  )
  return Math.round((b - a) / 86_400_000)
}

/**
 * En qué estado está un documento hoy.
 *
 * Un documento inactivo (reemplazado por su renovación) no avisa: si avisara,
 * cada póliza vieja de un camión estaría gritando para siempre.
 */
export function estadoDe(documento: DocumentoEquipo, hoy: string): EstadoDocumento {
  if (!documento.active) {
    return { estado: 'SIN_VENCIMIENTO', diasRestantes: null, mensaje: 'Reemplazado por otro.' }
  }

  if (!documento.expiresAt) {
    return {
      estado: 'SIN_VENCIMIENTO',
      diasRestantes: null,
      mensaje: 'Sin fecha de vencimiento.',
    }
  }

  const dias = diasEntre(hoy, documento.expiresAt)

  if (dias < 0) {
    const cuantos = Math.abs(dias)
    return {
      estado: 'VENCIDO',
      diasRestantes: dias,
      mensaje:
        cuantos === 1 ? 'Venció ayer.' : `Venció hace ${cuantos} días — el equipo está sin esto.`,
    }
  }

  if (dias <= documento.alertDaysBefore) {
    return {
      estado: 'POR_VENCER',
      diasRestantes: dias,
      mensaje:
        dias === 0
          ? 'Vence HOY.'
          : dias === 1
            ? 'Vence mañana.'
            : `Vence en ${dias} días.`,
    }
  }

  return { estado: 'VIGENTE', diasRestantes: dias, mensaje: `Vigente, vence en ${dias} días.` }
}

/** ¿Este documento tiene que aparecer en los avisos? */
export function requiereAtencion(documento: DocumentoEquipo, hoy: string): boolean {
  const { estado } = estadoDe(documento, hoy)
  return estado === 'VENCIDO' || estado === 'POR_VENCER'
}

/**
 * Ordena para la pantalla: primero lo vencido, después lo que está por vencer,
 * y dentro de cada grupo lo más urgente arriba.
 */
export function ordenarPorUrgencia<T extends DocumentoEquipo>(
  documentos: readonly T[],
  hoy: string,
): T[] {
  const peso: Record<EstadoVencimiento, number> = {
    VENCIDO: 0,
    POR_VENCER: 1,
    VIGENTE: 2,
    SIN_VENCIMIENTO: 3,
  }
  return [...documentos].sort((a, b) => {
    const ea = estadoDe(a, hoy)
    const eb = estadoDe(b, hoy)
    if (peso[ea.estado] !== peso[eb.estado]) return peso[ea.estado] - peso[eb.estado]
    if (ea.diasRestantes === null) return eb.diasRestantes === null ? 0 : 1
    if (eb.diasRestantes === null) return -1
    return ea.diasRestantes - eb.diasRestantes
  })
}

export const TONO_VENCIMIENTO: Record<EstadoVencimiento, 'critical' | 'warning' | 'good' | 'info'> =
  {
    VENCIDO: 'critical',
    POR_VENCER: 'warning',
    VIGENTE: 'good',
    SIN_VENCIMIENTO: 'info',
  }

export const ETIQUETA_VENCIMIENTO: Record<EstadoVencimiento, string> = {
  VENCIDO: 'Vencido',
  POR_VENCER: 'Por vencer',
  VIGENTE: 'Vigente',
  SIN_VENCIMIENTO: 'Sin vencimiento',
}
