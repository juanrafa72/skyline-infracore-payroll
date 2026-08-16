'use client'

import { useActionState, useState } from 'react'
import { guardarDevolucion } from '../cheques/actions'

/**
 * Anotar que el cliente devolvió (parte de) una retención.
 *
 * Cerrado por defecto: lo normal es que la retención siga quieta, y un
 * formulario abierto en cada fila haría ver como pendiente algo que solo se
 * toca el día que sueltan la plata.
 */
export function Devolucion({
  deductionId,
  vivo,
  hoy,
}: {
  deductionId: string
  /** Cuánto queda por devolver. */
  vivo: string
  hoy: string
}) {
  const [result, action, saving] = useActionState(guardarDevolucion, null)
  const [abierto, setAbierto] = useState(false)

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-1.5 rounded px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--hover)]"
      >
        Ya la devolvieron →
      </button>
    )
  }

  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="deductionId" value={deductionId} />
      <label className="text-xs">
        <span className="mb-0.5 block text-[var(--muted)]">Cuánto devolvieron</span>
        <input
          name="amount"
          defaultValue={vivo}
          required
          inputMode="decimal"
          className="h-8 w-28 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
        />
      </label>
      <label className="text-xs">
        <span className="mb-0.5 block text-[var(--muted)]">Cuándo</span>
        <input
          type="date"
          name="date"
          defaultValue={hoy}
          className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
        />
      </label>
      <label className="min-w-48 flex-1 text-xs">
        <span className="mb-0.5 block text-[var(--muted)]">Nota</span>
        <input
          name="note"
          placeholder="opcional"
          className="h-8 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={saving}
        className="brand-gradient inline-flex h-8 items-center rounded-full px-4 text-xs font-medium text-white disabled:opacity-45"
      >
        {saving ? 'Guardando…' : 'Anotar devolución'}
      </button>
      <button
        type="button"
        onClick={() => setAbierto(false)}
        className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)]"
      >
        cancelar
      </button>
      {result ? (
        <span
          className={`text-xs ${
            result.startsWith('LISTO|') ? 'text-emerald-800' : 'text-amber-800'
          }`}
        >
          {result.replace(/^LISTO\|/, '')}
        </span>
      ) : null}
    </form>
  )
}
