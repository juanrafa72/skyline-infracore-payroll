'use client'

import { useActionState } from 'react'
import { saveMissingRates } from './actions'

export interface MissingRow {
  workerId: string
  name: string
  code: string
  paymentLabel: string
  rateTypeLabel: string
  why: string
}

/**
 * Formulario masivo: una fila por persona sin tarifa, todo en un solo envío.
 *
 * Los montos vacíos se saltan — la pantalla sirve igual para llenar una
 * tarifa que para llenar sesenta. Cada fila dice POR QUÉ falta (el mismo
 * diagnóstico del motor), porque "no tiene ninguna" y "tiene una vencida" se
 * arreglan distinto.
 */
export function RatesForm({
  rows,
  defaultFrom,
  canManage,
}: {
  rows: readonly MissingRow[]
  defaultFrom: string
  canManage: boolean
}) {
  const [result, action, saving] = useActionState(saveMissingRates, null)
  const ok = result !== null && (result.startsWith('LISTO|') || result.startsWith('PARCIAL|'))

  return (
    <form action={action}>
      {result ? (
        <p
          className={`mb-4 rounded-md border p-3 text-sm ${
            ok
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {result.replace(/^(LISTO|PARCIAL)\|/, '')}
        </p>
      ) : null}

      <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        {rows.map((row) => (
          <li key={row.workerId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-[220px] flex-1">
              <p className="text-sm font-medium">{row.name}</p>
              <p className="text-xs text-[var(--muted)]">
                {row.code} · {row.paymentLabel}
              </p>
              <p className="mt-0.5 text-xs text-red-700">{row.why}</p>
            </div>

            {canManage ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
                    Tarifa {row.rateTypeLabel.toLowerCase()}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-[var(--muted)]">$</span>
                    <input
                      name={`tarifa:${row.workerId}`}
                      inputMode="decimal"
                      placeholder="180.00"
                      className="h-9 w-28 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm tabular-nums outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Desde</span>
                  <input
                    type="date"
                    name={`desde:${row.workerId}`}
                    defaultValue={defaultFrom}
                    className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm outline-none focus:border-[var(--accent)]"
                  />
                </label>
              </>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-45"
          >
            {saving ? 'Guardando…' : 'Guardar las tarifas escritas'}
          </button>
          <p className="text-xs text-[var(--muted)]">
            Las filas que dejes vacías no se tocan. Cada tarifa queda auditada.
          </p>
        </div>
      ) : (
        <p className="mt-4 rounded-md border border-[var(--border)] bg-[var(--hover)] p-3 text-sm text-[var(--muted)]">
          Tu rol puede ver esta lista pero no fijar tarifas. Los valores los pone quien aprueba.
        </p>
      )}
    </form>
  )
}
