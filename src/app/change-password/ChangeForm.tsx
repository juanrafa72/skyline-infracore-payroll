'use client'

import { useActionState } from 'react'
import { changePassword } from './actions'

export function ChangeForm() {
  const [error, action, saving] = useActionState(changePassword, null)

  return (
    <form action={action} className="space-y-3">
      {error ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
          {error}
        </p>
      ) : null}

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
          Contraseña actual
        </span>
        <input
          type="password"
          name="actual"
          required
          autoComplete="current-password"
          className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--accent)]"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
          Contraseña nueva (mínimo 10 caracteres)
        </span>
        <input
          type="password"
          name="nueva"
          required
          minLength={10}
          autoComplete="new-password"
          className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--accent)]"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
          Repite la contraseña nueva
        </span>
        <input
          type="password"
          name="repetida"
          required
          minLength={10}
          autoComplete="new-password"
          className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--accent)]"
        />
      </label>

      <button
        type="submit"
        disabled={saving}
        className="h-10 w-full rounded-md bg-[var(--accent,#0083d6)] text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-45"
      >
        {saving ? 'Cambiando…' : 'Cambiar contraseña y entrar'}
      </button>
    </form>
  )
}
