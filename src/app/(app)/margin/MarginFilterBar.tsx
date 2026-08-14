'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

export interface FilterOption {
  value: string
  label: string
}

/** Atajos de fecha. El año y el mes son las preguntas que más se hacen. */
function shortcuts(): ReadonlyArray<{ label: string; from: string; to: string }> {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const iso = (date: Date) => date.toISOString().slice(0, 10)

  const monthStart = new Date(Date.UTC(year, month, 1))
  const monthEnd = new Date(Date.UTC(year, month + 1, 0))
  const prevStart = new Date(Date.UTC(year, month - 1, 1))
  const prevEnd = new Date(Date.UTC(year, month, 0))

  return [
    { label: 'Este mes', from: iso(monthStart), to: iso(monthEnd) },
    { label: 'Mes pasado', from: iso(prevStart), to: iso(prevEnd) },
    { label: 'Este año', from: `${year}-01-01`, to: `${year}-12-31` },
    { label: 'Año pasado', from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
  ]
}

/**
 * Filtros de la rentabilidad.
 *
 * Van en la dirección web, no en memoria: así un resultado filtrado se puede
 * guardar en favoritos o mandárselo a alguien, y llega mostrando lo mismo.
 */
export function MarginFilterBar({
  crews,
  projects,
  customers,
  operations,
  current,
}: {
  crews: readonly FilterOption[]
  projects: readonly FilterOption[]
  customers: readonly FilterOption[]
  operations: readonly FilterOption[]
  current: Record<string, string | string[] | undefined>
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const value = (key: string) => {
    const raw = current[key]
    return (Array.isArray(raw) ? raw[0] : raw) ?? ''
  }

  function apply(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString())
    for (const [key, val] of Object.entries(changes)) {
      if (val === '') next.delete(key)
      else next.set(key, val)
    }
    const query = next.toString()
    startTransition(() => router.push(query ? `/margin?${query}` : '/margin'))
  }

  const active = ['desde', 'hasta', 'cuadrilla', 'proyecto', 'cliente', 'operacion'].filter(
    (key) => value(key) !== '',
  ).length

  return (
    <section className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        {shortcuts().map((shortcut) => {
          const on = value('desde') === shortcut.from && value('hasta') === shortcut.to
          return (
            <button
              key={shortcut.label}
              type="button"
              onClick={() => apply({ desde: shortcut.from, hasta: shortcut.to })}
              className={`h-8 rounded-full px-3 text-sm transition ${
                on
                  ? 'brand-gradient font-medium text-white'
                  : 'border border-[var(--border)] hover:bg-[var(--hover)]'
              }`}
            >
              {shortcut.label}
            </button>
          )
        })}

        {active > 0 ? (
          <button
            type="button"
            onClick={() => startTransition(() => router.push('/margin'))}
            className="h-8 rounded-full border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)]"
          >
            Quitar filtros ({active})
          </button>
        ) : null}

        {pending ? <span className="text-xs text-[var(--muted)]">actualizando…</span> : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <DateField label="Desde" name="desde" value={value('desde')} onChange={apply} />
        <DateField label="Hasta" name="hasta" value={value('hasta')} onChange={apply} />
        <Select label="Cuadrilla" name="cuadrilla" value={value('cuadrilla')} options={crews} onChange={apply} />
        <Select label="Proyecto" name="proyecto" value={value('proyecto')} options={projects} onChange={apply} />
        <Select label="Cliente" name="cliente" value={value('cliente')} options={customers} onChange={apply} />
        <Select label="Operación" name="operacion" value={value('operacion')} options={operations} onChange={apply} />
      </div>
    </section>
  )
}

function DateField({
  label,
  name,
  value,
  onChange,
}: {
  label: string
  name: string
  value: string
  onChange: (changes: Record<string, string>) => void
}) {
  return (
    <label className="block">
      <span className="brand-label mb-1 block text-[var(--muted)]">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange({ [name]: event.target.value })}
        className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
      />
    </label>
  )
}

function Select({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string
  name: string
  value: string
  options: readonly FilterOption[]
  onChange: (changes: Record<string, string>) => void
}) {
  return (
    <label className="block">
      <span className="brand-label mb-1 block text-[var(--muted)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange({ [name]: event.target.value })}
        className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
      >
        <option value="">todas</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
