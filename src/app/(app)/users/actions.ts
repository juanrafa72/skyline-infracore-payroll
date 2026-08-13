'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertCan } from '@/lib/auth/rbac'
import { hashPassword } from '@/lib/auth/password'
import { prisma } from '@/lib/db/client'

/**
 * Alta de usuario.
 *
 * La contraseña temporal se genera aquí y se devuelve una sola vez para
 * entregarla. No se guarda en texto plano ni se puede volver a ver.
 */
export async function createUser(_previous: string | null, formData: FormData): Promise<string> {
  const actor = await assertCan('user:manage')

  const parsed = z
    .object({
      name: z.string().trim().min(1),
      email: z.string().trim().email('Correo inválido'),
      roleId: z.string().min(1),
    })
    // Las casillas de compañía llegan repetidas con el mismo nombre; hay que
    // leerlas con getAll, no con Object.fromEntries (que se queda con una).
    .safeParse(Object.fromEntries(formData))

  const companyIds = formData.getAll('companyIds').map(String).filter(Boolean)
  if (companyIds.length === 0) return 'Elige al menos una compañía.'

  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Datos inválidos'

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } })
  if (existing) return 'Ya existe un usuario con ese correo.'

  const temporary = `${randomBytes(9).toString('base64url')}aa`
  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      passwordHash: await hashPassword(temporary),
      status: 'ACTIVE',
      mustChangePassword: true,
    },
  })

  for (const companyId of companyIds) {
    await prisma.userCompanyRole.create({
      data: { userId: user.id, companyId, roleId: parsed.data.roleId, assignedById: actor.id },
    })
  }

  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId: actor.id,
      userEmailSnapshot: actor.email,
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: user.id,
      newValueJson: { email: user.email, roleId: parsed.data.roleId },
      changedFields: ['email', 'role'],
    },
  })

  revalidatePath('/users')
  return `LISTO|${user.email}|${temporary}`
}

export async function setUserStatus(formData: FormData) {
  const actor = await assertCan('user:manage')
  const userId = String(formData.get('userId') ?? '')
  const status = String(formData.get('status') ?? '') as 'ACTIVE' | 'SUSPENDED'

  if (userId === actor.id) {
    throw new Error('No puedes desactivar tu propio usuario.')
  }

  const before = await prisma.user.findUnique({ where: { id: userId } })
  await prisma.user.update({ where: { id: userId }, data: { status } })

  // Al suspender, se cierran sus sesiones abiertas: si no, seguiría dentro.
  if (status === 'SUSPENDED') {
    await prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId: actor.id,
      userEmailSnapshot: actor.email,
      action: 'USER_STATUS_CHANGED',
      entityType: 'User',
      entityId: userId,
      oldValueJson: { status: before?.status },
      newValueJson: { status },
      changedFields: ['status'],
    },
  })

  revalidatePath('/users')
}

export async function resetPassword(formData: FormData): Promise<void> {
  const actor = await assertCan('user:manage')
  const userId = String(formData.get('userId') ?? '')

  const temporary = `${randomBytes(9).toString('base64url')}aa`
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(temporary),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    })
    await tx.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    await tx.auditLog.create({
      data: {
        companyId: actor.companyId,
        userId: actor.id,
        userEmailSnapshot: actor.email,
        action: 'USER_PASSWORD_RESET',
        entityType: 'User',
        entityId: userId,
        changedFields: ['passwordHash'],
      },
    })
  })

  revalidatePath(`/users?nueva=${encodeURIComponent(temporary)}&para=${userId}`)
}
