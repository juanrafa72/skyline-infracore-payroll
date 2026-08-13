/**
 * Nombres de empresas receptoras: normalización y detección de duplicados.
 *
 * Puro a propósito. Que "Forzo LLC", "FORZO  L.L.C." y "forzo llc" sean la
 * misma empresa es una regla, y una regla se prueba sin base de datos.
 */

/** Sufijos societarios que no distinguen a una empresa de otra. */
const SUFFIXES = [
  'llc',
  'l l c',
  'inc',
  'corp',
  'corporation',
  'co',
  'company',
  'ltd',
  'limited',
  'sa',
  'sas',
  'srl',
]

/**
 * Forma comparable de un nombre: sin tildes, sin puntuación, sin dobles
 * espacios, en minúsculas.
 *
 * Se guarda en la base para que el índice único haga cumplir la unicidad. No
 * se muestra nunca: el nombre que ve la gente es el que escribieron.
 */
export function normalizeRecipientName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** La misma forma comparable, además sin el sufijo societario del final. */
export function coreRecipientName(name: string): string {
  let core = normalizeRecipientName(name)
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of SUFFIXES) {
      if (core.endsWith(` ${suffix}`)) {
        core = core.slice(0, -(suffix.length + 1)).trim()
        changed = true
      }
    }
  }
  return core || normalizeRecipientName(name)
}

export interface RecipientCandidate {
  id: string
  name: string
  normalizedName: string
  active: boolean
}

export interface DuplicateMatch {
  id: string
  name: string
  active: boolean
  /** `exact` bloquea la creación. `similar` solo avisa. */
  kind: 'exact' | 'similar'
  why: string
}

/**
 * Busca si una empresa receptora ya existe antes de crearla.
 *
 * Un duplicado exacto se rechaza. Uno parecido solo se advierte: decidir si
 * "Forzo Construction" y "Forzo Fiber" son la misma empresa no le toca al
 * sistema, le toca a quien conoce el negocio.
 */
export function findDuplicate(
  name: string,
  existing: readonly RecipientCandidate[],
): DuplicateMatch | null {
  const normalized = normalizeRecipientName(name)
  if (!normalized) return null

  const exact = existing.find((row) => row.normalizedName === normalized)
  if (exact) {
    return {
      id: exact.id,
      name: exact.name,
      active: exact.active,
      kind: 'exact',
      why: exact.active
        ? 'Ya existe con ese nombre.'
        : 'Ya existe con ese nombre, pero está inactiva. Actívala en lugar de crear otra.',
    }
  }

  const core = coreRecipientName(name)
  if (!core) return null

  const similar = existing.find((row) => coreRecipientName(row.name) === core)
  if (similar) {
    return {
      id: similar.id,
      name: similar.name,
      active: similar.active,
      kind: 'similar',
      why: `Se parece mucho a «${similar.name}». Si es la misma, usa esa; si no, cámbiale el nombre para poder distinguirlas.`,
    }
  }

  return null
}
