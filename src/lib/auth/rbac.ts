import { cookies } from 'next/headers'
import { cache } from 'react'
import { prisma } from '@/lib/db/client'
import { SESSION_COOKIE, unseal } from './session'

/**
 * Quién está usando el sistema, en qué compañía, y qué puede hacer.
 *
 * Todo se resuelve contra la base de datos: la cookie solo dice qué sesión
 * mirar. Un permiso nunca se deduce de algo que venga del navegador.
 */
export interface CurrentUser {
  id: string
  name: string
  email: string
  companyId: string
  companyCode: string
  companyName: string
  roleCodes: readonly string[]
  permissions: ReadonlySet<string>
  availableCompanies: ReadonlyArray<{ id: string; code: string; displayName: string }>
}

/** `cache` evita repetir la consulta varias veces en la misma petición. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies()
  const raw = store.get(SESSION_COOKIE)?.value
  if (!raw) return null

  const sessionId = await unseal(raw)
  if (!sessionId) return null

  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        include: {
          companyRoles: {
            where: { active: true, revokedAt: null },
            include: {
              company: true,
              role: { include: { permissions: { include: { permission: true } } } },
            },
          },
        },
      },
    },
  })

  if (!session || session.revokedAt || session.expiresAt < new Date()) return null
  if (session.user.status !== 'ACTIVE') return null

  const assignments = session.user.companyRoles
  if (assignments.length === 0) return null

  const companies = [...new Map(assignments.map((a) => [a.company.id, a.company])).values()]
  const active =
    companies.find((company) => company.id === session.activeCompanyId) ?? companies[0]!

  const here = assignments.filter((assignment) => assignment.companyId === active.id)

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    companyId: active.id,
    companyCode: active.code,
    companyName: active.displayName,
    roleCodes: here.map((assignment) => assignment.role.code),
    permissions: new Set(
      here.flatMap((assignment) =>
        assignment.role.permissions.map((link) => link.permission.code),
      ),
    ),
    availableCompanies: companies.map((company) => ({
      id: company.id,
      code: company.code,
      displayName: company.displayName,
    })),
  }
})

/** Usuario o error. Para pantallas que exigen sesión. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Sesión requerida')
  return user
}

/**
 * Verifica un permiso. **Lanza** si no lo tiene.
 *
 * A propósito no devuelve un booleano: un booleano se puede ignorar por
 * descuido y el sistema seguiría adelante. Esto detiene la operación.
 */
export async function assertCan(permission: string): Promise<CurrentUser> {
  const user = await requireUser()
  if (!user.permissions.has(permission)) {
    throw new Error(
      `No tienes permiso para esto (${permission}). Tu rol es ${user.roleCodes.join(', ') || 'ninguno'}.`,
    )
  }
  return user
}

export async function can(permission: string): Promise<boolean> {
  const user = await getCurrentUser()
  return user?.permissions.has(permission) ?? false
}

/**
 * Segregación de funciones (SoD-1, SoD-2).
 *
 * Quien preparó no aprueba; quien aprobó no paga. Se comprueba con el id de la
 * persona, no con su rol: tener el permiso no basta si fue quien hizo el paso
 * anterior.
 */
export function assertDifferentPerson(
  actorId: string,
  previousActorId: string | null,
  what: string,
): void {
  if (previousActorId && actorId === previousActorId) {
    throw new Error(
      `No puedes ${what} algo que tú mismo hiciste en el paso anterior. Debe hacerlo otra persona.`,
    )
  }
}
