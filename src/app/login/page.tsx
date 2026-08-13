import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string }>
}) {
  const { volver } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
            Payroll &amp; Financial Control
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            Skyline Advance Tech · Infracore
          </h1>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <LoginForm returnTo={volver ?? '/dashboard'} />
        </div>

        <p className="mt-4 text-center text-xs text-[var(--muted)]">
          Cada persona entra con su propio usuario. Todo lo que se haga queda registrado.
        </p>
      </div>
    </main>
  )
}
