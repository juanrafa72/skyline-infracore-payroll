'use client'

import { useActionState } from 'react'
import { createUser } from './actions'

export function NewUserForm({
  roles,
  companies,
}: {
  roles: ReadonlyArray<{ id: string; label: string }>
  companies: ReadonlyArray<{ id: string; label: string }>
}) {
  const [result, action] = useActionState(createUser, null)
  const created = result?.startsWith('LISTO|') ? result.split('|') : null

  return (
    <>
      {created ? (
        <div className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm">
          <p className="font-semibold text-emerald-900">Usuario creado: {created[1]}</p>
          <p className="mt-1 text-emerald-900">Contraseña temporal:</p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 font-mono text-sm">
            {created[2]}
          </code>
          <p className="mt-2 text-xs text-emerald-800">
            Cópiala ahora. No se puede volver a ver.
          </p>
        </div>
      ) : null}

      {result && !created ? (
        <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-2.5 text-sm text-red-700">
          {result}
        </p>
      ) : null}

      <form action={action} className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Nombre</span>
          <input
            name="name"
            required
            className="h-9 w-full rounded-md border border-[var(--border)] px-2.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Correo</span>
          <input
            name="email"
            type="email"
            required
            className="h-9 w-full rounded-md border border-[var(--border)] px-2.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Rol</span>
          <select
            name="roleId"
            className="h-9 w-full rounded-md border border-[var(--border)] px-2 text-sm"
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-[var(--muted)]">Compañías</legend>
          <div className="space-y-1">
            {companies.map((company) => (
              <label key={company.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="companyIds" value={company.id} defaultChecked />
                {company.label}
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="submit"
          className="h-9 w-full rounded-md bg-[var(--accent)] text-sm font-medium text-white hover:opacity-90"
        >
          Crear usuario
        </button>
      </form>
    </>
  )
}
