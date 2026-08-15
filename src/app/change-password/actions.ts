'use server'

import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/rbac'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { prisma } from '@/lib/db/client'

/**
 * Cambio de contraseña del propio usuario.
 *
 * Exige la contraseña actual: una sesión abierta en un computador ajeno no
 * debe alcanzar para apropiarse de la cuenta. Al cambiarla se apaga
 * `mustChangePassword`, que es lo que mantiene bloqueada la entrada cuando la
 * contraseña es la temporal impresa al crear el usuario.
 */
export async function changePassword(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const current = String(formData.get('actual') ?? '')
  const next = String(formData.get('nueva') ?? '')
  const repeated = String(formData.get('repetida') ?? '')

  if (next.length < 10) return 'La contraseña nueva debe tener al menos 10 caracteres.'
  if (next !== repeated) return 'Las dos contraseñas nuevas no coinciden.'
  if (next === current) return 'La nueva no puede ser igual a la actual.'

  const account = await prisma.user.findUnique({ where: { id: user.id } })
  if (!account?.passwordHash) {
    return 'Tu usuario no tiene contraseña configurada. Habla con el administrador.'
  }

  const valid = await verifyPassword(current, account.passwordHash)
  if (!valid) return 'La contraseña actual no es correcta.'

  const newHash = await hashPassword(next)

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash, mustChangePassword: false },
    }),
    prisma.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'PASSWORD_CHANGED',
        entityType: 'User',
        entityId: user.id,
        changedFields: ['passwordHash'],
      },
    }),
  ])

  redirect('/dashboard')
}
