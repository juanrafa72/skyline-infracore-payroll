'use client'

import { useState } from 'react'
import { addWorkerToPeriod } from '../actions'

export interface Candidate {
  id: string
  name: string
  rate: string | null
  rateType: string
  crew: string | null
}

/**
 * Elegir quién trabajó esta semana.
 *
 * La tarifa se muestra junto al nombre, no en una columna aparte: es el dato
 * con el que más fácil se comete un error, y hay nombres muy parecidos en las
 * listas (los sufijos que venían del Excel).
 */
export function WorkerPicker({
  weekId,
  candidates,
}: {
  weekId: string
  candidates: readonly Candidate[]
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filtered =
    search.trim() === ''
      ? candidates
      : candidates.filter((person) =>
          person.name.toLowerCase().includes(search.trim().toLowerCase()),
        )

  if (candidates.length === 0) return null

  return (
    <div className="mt-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium">
          ¿Falta alguien? Elegir de la lista ({candidates.length} personas)
        </span>
        <span className="text-lg leading-none text-[var(--muted)]">{open ? '−' : '+'}</span>
      </button>

      {open ? (
        <form action={addWorkerToPeriod} className="border-t border-[var(--border)] p-4">
          <input type="hidden" name="weekId" value={weekId} />

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre…"
            className="mb-3 h-9 w-full rounded-md border border-[var(--border)] px-2.5 text-sm"
          />

          <p className="mb-2 text-xs text-[var(--muted)]">
            Marca a quienes trabajaron. Revisa la tarifa antes de marcar: hay nombres muy
            parecidos.
          </p>

          <div className="max-h-72 space-y-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--muted)]">
                Nadie coincide con «{search}».
              </p>
            ) : (
              filtered.map((person) => (
                <label
                  key={person.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-[var(--border)] px-3 py-2 hover:bg-[var(--hover)]"
                >
                  <input type="checkbox" name="workerId" value={person.id} className="h-4 w-4" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{person.name}</span>
                    <span className="block text-xs">
                      {person.rate ? (
                        <span className="text-[var(--muted)]">
                          ${person.rate} {person.rateType}
                          {person.crew ? ` · ${person.crew}` : ''}
                        </span>
                      ) : (
                        <span className="font-medium text-red-600">
                          sin tarifa — no se podrá calcular
                        </span>
                      )}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>

          <button
            type="submit"
            className="mt-3 h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90"
          >
            Agregar los marcados
          </button>
        </form>
      ) : null}
    </div>
  )
}
