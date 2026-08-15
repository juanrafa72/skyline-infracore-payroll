import { redirect } from 'next/navigation'
import { Shell } from '@/components/shell/Shell'
import { getCurrentUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { brandFor } from '@/lib/brand'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()

  // El middleware ya filtró las cookies sin firma. Aquí se comprueba lo que de
  // verdad importa: que la sesión siga viva y que el usuario tenga acceso.
  if (!user) redirect('/login')

  /*
   * Contraseña temporal: hasta que la cambie, no entra a nada. La pantalla de
   * cambio vive FUERA de este grupo (como /login) — si viviera adentro, este
   * redirect se aplicaría también a ella y sería un ciclo infinito.
   */
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { mustChangePassword: true },
  })
  if (account?.mustChangePassword) redirect('/change-password')

  // La piel sale de la compañía activa de la sesión, no de la URL: cambiar de
  // compañía cambia la marca entera, y nadie puede forzar otra desde afuera.
  const brand = brandFor(user.companyCode)

  return (
    <Shell
      companies={user.availableCompanies}
      active={{ id: user.companyId, displayName: user.companyName }}
      user={{ name: user.name, roles: user.roleCodes }}
      canSwitchCompany={user.permissions.has('company:switch')}
      permissions={[...user.permissions]}
      brand={brand}
    >
      {children}
    </Shell>
  )
}
