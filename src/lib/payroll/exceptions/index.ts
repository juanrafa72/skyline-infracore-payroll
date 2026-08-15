/**
 * Avisos: qué bloquea de verdad, y qué se puede cerrar.
 *
 * Antes se creaban avisos y NUNCA se cerraban: la base tiene cuatro estados
 * (OPEN, ACKNOWLEDGED, RESOLVED, DISMISSED) y el código solo escribía el
 * primero. Resultado: quien corregía el problema seguía bloqueado, sin
 * ninguna pantalla donde decir «ya está». Ese callejón sin salida es el
 * motivo de este archivo.
 *
 * Puro a propósito: la regla de qué bloquea se prueba sin base de datos.
 */

/** Un aviso que nace del histórico del Excel, no del trabajo de la semana. */
const DEL_HISTORICO: ReadonlySet<string> = new Set([
  'DUPLICATE_WORK_ENTRY',
  'CROSS_COMPANY_DUPLICATE',
  'DUPLICATE_WORKER',
  'REVIEW_ENTITY_TYPE',
])

/**
 * ¿De dónde salió este aviso?
 *
 * `IMPORT` = lo trajo el Excel al importarlo. Es una diferencia del archivo
 * histórico y **no** puede frenar la nómina que se está haciendo hoy: la
 * importación NO crea nóminas (BR-153), así que ese día ya se pagó por fuera.
 * `TRABAJO` = lo produjo el cálculo o el flujo de esta semana.
 */
export function origen(code: string, entityType: string): 'IMPORT' | 'TRABAJO' {
  if (entityType === 'ImportBatch') return 'IMPORT'
  return DEL_HISTORICO.has(code) ? 'IMPORT' : 'TRABAJO'
}

/**
 * ¿Este aviso frena el pago de ALGUIEN en concreto?
 *
 * Solo si es crítico Y salió del trabajo de la semana Y apunta a un pagable.
 * Un aviso del histórico se ve, se explica y se puede archivar, pero jamás
 * bloquea: si lo hiciera, importar el Excel dejaría la aplicación inservible
 * para siempre — que es exactamente lo que pasaba.
 */
export function bloquea(aviso: {
  level: string
  status: string
  code: string
  entityType: string
  entityId: string | null
}): boolean {
  if (aviso.status !== 'OPEN') return false
  if (aviso.level !== 'CRITICAL') return false
  if (origen(aviso.code, aviso.entityType) === 'IMPORT') return false
  return aviso.entityId !== null
}

/** Cómo se cerró un aviso. Ambos son definitivos; cambia el porqué. */
export type CierreAviso = 'RESOLVED' | 'DISMISSED'

export const CIERRE_ETIQUETA: Record<CierreAviso, string> = {
  RESOLVED: 'Resuelto',
  DISMISSED: 'Descartado',
}

/**
 * Texto que explica cada aviso en palabras del negocio, y qué hacer.
 *
 * Sin esto la pantalla muestra el código en inglés (`CHANGED_AFTER_APPROVAL`)
 * y nadie sabe si es grave ni qué se espera de uno.
 */
export const AVISO_AYUDA: Record<string, { queEs: string; queHacer: string }> = {
  CHANGED_AFTER_APPROVAL: {
    queEs:
      'La nómina ya estaba aprobada y después alguien cambió algo que afecta el pago ' +
      '(días, tarifa, un descuento). La aprobación se cayó sola, a propósito.',
    queHacer:
      'Revisa que los números de ahora sean los correctos y vuelve a aprobarla. ' +
      'Después de revisarla, cierra este aviso.',
  },
  DUPLICATE_WORK_ENTRY: {
    queEs:
      'Al importar el Excel apareció el mismo día de la misma persona dos veces. ' +
      'Viene del archivo histórico, no de la semana que estás haciendo.',
    queHacer:
      'Si ese día ya se pagó por fuera, archiva el aviso. Si no, corrige el día en la semana que corresponda.',
  },
  CROSS_COMPANY_DUPLICATE: {
    queEs:
      'El mismo día de la misma persona aparece en el Excel de Skyline y en el de ' +
      'Infracore. Uno de los dos libros lo tiene de más.',
    queHacer:
      'Decide de qué compañía es ese día. Si ya está resuelto en el archivo, archiva el aviso.',
  },
  DUPLICATE_WORKER: {
    queEs:
      'Dos fichas que podrían ser la misma persona con el nombre escrito distinto ' +
      '(por ejemplo «ISAAC CEBALLOS-UG» e «ISSAC CEBALLOS BORRERO»). No se unieron ' +
      'solas a propósito: unir a la persona equivocada mezcla tarifas y pagos.',
    queHacer:
      'Si son la misma persona, únelas en Catálogos → Trabajadores. Si son dos personas distintas, archiva el aviso.',
  },
  REVIEW_ENTITY_TYPE: {
    queEs:
      'En el Excel había una fila que puede ser una persona, una máquina o una ' +
      'cuadrilla, y el sistema no pudo decidirlo solo.',
    queHacer: 'Revisa la ficha en Catálogos y archiva el aviso cuando esté clasificada.',
  },
}

export function ayudaDe(code: string): { queEs: string; queHacer: string } {
  return (
    AVISO_AYUDA[code] ?? {
      queEs: 'Una revisión que el sistema dejó anotada.',
      queHacer: 'Revísala y ciérrala cuando esté atendida.',
    }
  )
}
