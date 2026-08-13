import { cookies } from 'next/headers'
import { prisma } from '@/lib/db/client'

export const SESSION_COOKIE = 'payroll_session'
const SESSION_HOURS = 12

/**
 * La cookie lleva el id de sesión y una firma.
 *
 * La firma permite que el middleware descarte cookies falsas sin consultar la
 * base de datos (no puede: corre en el borde). La validez real —que la sesión
 * exista, no esté vencida ni revocada— se verifica siempre contra la base,
 * dentro de la aplicación. La firma sola nunca autoriza nada.
 */
function secret(): string {
  const value = process.env.SESSION_SECRET
  if (!value || value.length < 32) {
    throw new Error(
      'Falta SESSION_SECRET (mínimo 32 caracteres). Sin eso las sesiones no se pueden firmar.',
    )
  }
  return value
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return Buffer.from(signature).toString('base64url')
}

export async function seal(sessionId: string): Promise<string> {
  return `${sessionId}.${await sign(sessionId)}`
}

/** Verifica solo la firma. NO dice que la sesión siga viva. */
export async function unseal(cookieValue: string): Promise<string | null> {
  const separator = cookieValue.lastIndexOf('.')
  if (separator <= 0) return null
  const sessionId = cookieValue.slice(0, separator)
  const signature = cookieValue.slice(separator + 1)
  const expected = await sign(sessionId)
  return timingSafeEqual(signature, expected) ? sessionId : null
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}

export async function createSession(
  userId: string,
  context: { ip?: string | undefined; userAgent?: string | undefined; companyId?: string | undefined },
): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000)
  const session = await prisma.userSession.create({
    data: {
      userId,
      expiresAt,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      activeCompanyId: context.companyId ?? null,
    },
  })

  const store = await cookies()
  store.set(SESSION_COOKIE, await seal(session.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  const raw = store.get(SESSION_COOKIE)?.value
  if (raw) {
    const sessionId = await unseal(raw)
    if (sessionId) {
      await prisma.userSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    }
  }
  store.delete(SESSION_COOKIE)
}

export async function setActiveCompany(companyId: string): Promise<void> {
  const store = await cookies()
  const raw = store.get(SESSION_COOKIE)?.value
  if (!raw) return
  const sessionId = await unseal(raw)
  if (!sessionId) return
  await prisma.userSession.update({ where: { id: sessionId }, data: { activeCompanyId: companyId } })
}
