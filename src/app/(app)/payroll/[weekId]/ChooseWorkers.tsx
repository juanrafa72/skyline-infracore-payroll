'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { createWorkerWithRate, setPeriodRoster } from '../actions'

export interface Person {
  id: string
  name: string
  rate: string | null
  rateType: string
  crew: string | null
  operation: string | null
  chosen: boolean
  hasDays: boolean
}

/**
 * Paso 1: quiénes trabajaron esta semana.
 *
 * Se elige primero la gente y después se marcan los días. Es el orden en que
 * ocurre en la realidad, y evita tener al frente una lista de 149 personas
 * cuando solo trabajaron doce.
 *
 * La tarifa va junto al nombre porque hay nombres casi idénticos heredados del
 * Excel: el nombre solo no alcanza para distinguirlos.
 */
export function ChooseWorkers({
  weekId,
  people,
  operations,
  hiddenWithoutRate,
}: {
  weekId: string
  people: readonly Person[]
  operations: ReadonlyArray<{ id: string; name: string }>
  /** Cuántas personas quedaron fuera de la lista por no tener tarifa. */
  hiddenWithoutRate: number
}) {
  const [message, action] = useActionState(setPeriodRoster, null)
  const [search, setSearch] = useState('')
  const [operation, setOperation] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(people.filter((person) => person.chosen).map((person) => person.id)),
  )

  const visible = people.filter((person) => {
    if (operation && person.operation !== operation) return false
    if (search.trim() === '') return true
    return person.name.toLowerCase().includes(search.trim().toLowerCase())
  })

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <form action={action}>
      <input type="hidden" name="weekId" value={weekId} />

      <div className="rounded-xl border-2 border-[var(--accent)] bg-[var(--surface)] p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">Paso 1</p>
        <h2 className="mt-1 text-lg font-semibold">¿Quiénes trabajaron esta semana?</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Marca a las personas. En el siguiente paso les pones los días. Revisa la tarifa antes
          de marcar: hay nombres muy parecidos.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre…"
            className="h-10 min-w-[220px] flex-1 rounded-md border border-[var(--border)] px-3 text-sm"
          />
          <select
            value={operation}
            onChange={(event) => setOperation(event.target.value)}
            className="h-10 rounded-md border border-[var(--border)] px-2 text-sm"
          >
            <option value="">Todas las operaciones</option>
            {operations.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 max-h-[26rem] space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              Nadie coincide con la búsqueda.
            </p>
          ) : (
            visible.map((person) => {
              const isSelected = selected.has(person.id)
              return (
                <label
                  key={person.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition ${
                    isSelected
                      ? 'border-[var(--accent)] bg-sky-50'
                      : 'border-transparent hover:bg-[var(--hover)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    name="workerId"
                    value={person.id}
                    checked={isSelected}
                    onChange={() => toggle(person.id)}
                    className="h-5 w-5 shrink-0"
                  />
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
                  {person.hasDays ? (
                    <span className="shrink-0 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800">
                      ya tiene días
                    </span>
                  ) : null}
                </label>
              )
            })
          )}
        </div>

        {hiddenWithoutRate > 0 ? (
          <p className="mt-3 text-xs text-[var(--muted)]">
            {hiddenWithoutRate} persona(s) no aparecen porque no tienen tarifa.{' '}
            <Link prefetch={false} href="/workers" className="text-[var(--accent)] underline">
              Ponerles tarifa
            </Link>
          </p>
        ) : null}

        {message ? (
          <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {message}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={selected.size === 0}
            className="h-11 rounded-lg bg-[var(--accent)] px-6 text-base font-semibold text-white transition hover:opacity-90 disabled:opacity-45"
          >
            Continuar con {selected.size} persona{selected.size === 1 ? '' : 's'} →
          </button>
          <Link
            prefetch={false}
            href={`/payroll/${weekId}`}
            className="text-sm text-[var(--muted)] underline"
          >
            Cancelar
          </Link>
        </div>
      </div>
    </form>
  )
}

/** Crear una persona con su tarifa, sin salir de la nómina. */
export function AddWorkerInline({
  weekId,
  operations,
}: {
  weekId: string
  operations: ReadonlyArray<{ id: string; name: string }>
}) {
  const [result, action] = useActionState(createWorkerWithRate, null)
  const [open, setOpen] = useState(false)
  const done = result?.startsWith('LISTO|')

  return (
    <div className="mt-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium">¿Es alguien nuevo? Agregar con su tarifa</span>
        <span className="text-lg leading-none text-[var(--muted)]">{open ? '−' : '+'}</span>
      </button>

      {open ? (
        <form action={action} className="border-t border-[var(--border)] p-4">
          <input type="hidden" name="weekId" value={weekId} />

          {result ? (
            <p
              className={`mb-3 rounded-md border p-2.5 text-sm ${
                done
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : 'border-red-300 bg-red-50 text-red-700'
              }`}
            >
              {result.replace(/^LISTO\|/, '')}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Nombre completo
              </span>
              <input
                name="name"
                required
                placeholder="Mario Aponte"
                className="h-9 w-full rounded-md border border-[var(--border)] px-2.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Tarifa</span>
              <input
                name="rate"
                required
                inputMode="decimal"
                placeholder="200.00"
                className="h-9 w-full rounded-md border border-[var(--border)] px-2.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Se paga</span>
              <select
                name="rateType"
                className="h-9 w-full rounded-md border border-[var(--border)] px-2 text-sm"
              >
                <option value="DAILY">Por día</option>
                <option value="HOURLY">Por hora</option>
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Operación</span>
              <select
                name="operationId"
                className="h-9 w-full rounded-md border border-[var(--border)] px-2 text-sm"
              >
                <option value="">— ninguna —</option>
                {operations.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="submit"
            className="mt-3 h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90"
          >
            Agregar a la semana
          </button>
        </form>
      ) : null}
    </div>
  )
}
