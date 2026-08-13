'use client'

import { useActionState } from 'react'
import { recordProduction } from './actions'

export function ProductionForm({
  options,
  defaultDate,
}: {
  options: ReadonlyArray<{ id: string; crewId: string; label: string }>
  defaultDate: string
}) {
  const [result, action] = useActionState(recordProduction, null)
  const done = result?.startsWith('LISTO|') ? result.split('|') : null

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold">Registrar producción</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Elige la cuadrilla y el concepto: el precio lo pone el sistema según lo negociado.
      </p>

      {done ? (
        <p className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 p-2.5 text-sm text-emerald-900">
          Registrado: {done[2]} de {done[1]} = ${done[3]}
        </p>
      ) : null}

      {result && !done ? (
        <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-2.5 text-sm text-red-700">
          {result}
        </p>
      ) : null}

      <form action={action} className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
            Cuadrilla y concepto
          </span>
          <select
            name="pricingId"
            required
            onChange={(event) => {
              const option = options.find((row) => row.id === event.target.value)
              const hidden = event.currentTarget.form?.elements.namedItem('crewId')
              if (hidden instanceof HTMLInputElement && option) hidden.value = option.crewId
            }}
            className="h-9 w-full rounded-md border border-[var(--border)] px-2 text-sm"
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="crewId" defaultValue={options[0]?.crewId ?? ''} />

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Fecha</span>
          <input
            name="productionDate"
            type="date"
            required
            defaultValue={defaultDate}
            className="h-9 w-full rounded-md border border-[var(--border)] px-2.5 text-sm"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Cantidad</span>
          <input
            name="quantity"
            required
            inputMode="decimal"
            placeholder="1250"
            className="h-9 w-full rounded-md border border-[var(--border)] px-2.5 text-sm"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Nota</span>
          <input
            name="notes"
            placeholder="Tramo norte"
            className="h-9 w-full rounded-md border border-[var(--border)] px-2.5 text-sm"
          />
        </label>

        <button
          type="submit"
          className="h-9 w-full rounded-md bg-[var(--accent)] text-sm font-medium text-white hover:opacity-90"
        >
          Registrar
        </button>
      </form>
    </div>
  )
}
