'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { prisma } from '@/lib/db/client'
import { verifyPassword } from '@/lib/auth/password'
import { createSession, destroySession } from '@/lib/auth/session'

const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 15

export async function login(_previous: string | null, formData: FormData): Promise<string> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const back = String(formData.get('volver') ?? '/dashboard')

  if (!email || !password) return 'Escribe tu correo y tu contraseña.'

  const user = await prisma.user.findUnique({
    where: { email },
    include: { companyRoles: { where: { active: true, revokedAt: null } } },
  })

  // El mismo mensaje si el correo no existe o la clave está mal: decir cuál de
  // los dos falló le confirmaría a un atacante qué correos son válidos.
  const genericError = 'Correo o contraseña incorrectos.'

  if (!user || !user.passwordHash) return genericError
  if (user.status !== 'ACTIVE') return 'Tu usuario está desactivado. Habla con el administrador.'

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000)
    return `Demasiados intentos. Vuelve a intentar en ${minutes} minuto(s).`
  }

  const valid = await verifyPassword(password, user.passwordHash)

  if (!valid) {
    const attempts = user.failedLoginCount + 1
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: attempts,
        lockedUntil:
          attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    })
    return attempts >= MAX_ATTEMPTS
      ? `Demasiados intentos. Espera ${LOCK_MINUTES} minutos.`
      : genericError
  }

  if (user.companyRoles.length === 0) {
    return 'Tu usuario no tiene ninguna compañía asignada. Habla con el administrador.'
  }

  const headerList = await headers()
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  })

  await createSession(user.id, {
    ip: headerList.get('x-forwarded-for') ?? undefined,
    userAgent: headerList.get('user-agent') ?? undefined,
    companyId: user.companyRoles[0]!.companyId,
  })

  await prisma.auditLog.create({
    data: {
      companyId: user.companyRoles[0]!.companyId,
      userId: user.id,
      userEmailSnapshot: user.email,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      changedFields: [],
      ip: headerList.get('x-forwarded-for') ?? null,
    },
  })

  redirect(back.startsWith('/') ? back : '/dashboard')
}

export async function logout() {
  await destroySession()
  redirect('/login')
}
