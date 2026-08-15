import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/rbac'
import { ChangeForm } from './ChangeForm'

export const dynamic = 'force-dynamic'

/**
 * Cambio de contraseña.
 *
 * Vive FUERA del grupo (app) a propósito: el layout de la aplicación redirige
 * aquí a quien tenga contraseña temporal, y si esta página estuviera adentro,
 * ese redirect la alcanzaría a ella misma y sería un ciclo.
 */
export default async function ChangePasswordPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
            {user.companyName}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Cambia tu contraseña</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Hola, {user.name}. Tu contraseña actual es temporal: escoge una tuya para seguir.
          </p>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <ChangeForm />
        </div>

        <p className="mt-4 text-center text-xs text-[var(--muted)]">
          El cambio queda registrado. Nadie más — ni el administrador — puede ver tu contraseña.
        </p>
      </div>
    </main>
  )
}
