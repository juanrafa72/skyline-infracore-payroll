'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { login } from './actions'

export function LoginForm({ returnTo }: { returnTo: string }) {
  const [error, action] = useActionState(login, null)

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="volver" value={returnTo} />

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Correo</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--accent)]"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Contraseña</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--accent)]"
        />
      </label>

      {error ? (
        <p className="rounded-md border border-red-300 bg-red-50 p-2.5 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 w-full rounded-md bg-[var(--accent)] text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Entrando…' : 'Entrar'}
    </button>
  )
}
