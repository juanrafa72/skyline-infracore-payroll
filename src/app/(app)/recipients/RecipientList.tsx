'use client'

import { useActionState, useState } from 'react'
import { RecipientForm, type RecipientValues } from './RecipientForm'
import { toggleRecipientActive } from './actions'

export interface RecipientRow extends RecipientValues {
  id: string
  name: string
  active: boolean
  orderCount: number
  paidTotal: string
  pendingCount: number
}

function currency(value: string): string {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function RecipientList({ rows }: { rows: readonly RecipientRow[] }) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [result, toggle, pending] = useActionState(toggleRecipientActive, null)

  const term = query.trim().toLowerCase()
  const visible = term
    ? rows.filter(
        (row) =>
          row.name.toLowerCase().includes(term) ||
          (row.legalName ?? '').toLowerCase().includes(term) ||
          (row.taxId ?? '').toLowerCase().includes(term),
      )
    : rows

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por nombre, razón social o EIN"
          className="h-9 min-w-[240px] flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm"
        />
        <span className="text-xs text-[var(--muted)]">
          {visible.length} de {rows.length}
        </span>
      </div>

      {result ? (
        <p
          className={`mb-3 rounded-md border p-2.5 text-sm ${
            result.startsWith('LISTO|')
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {result.replace(/^LISTO\|/, '')}
        </p>
      ) : null}

      <div className="space-y-2">
        {visible.map((row) => (
          <div
            key={row.id}
            className={`rounded-lg border bg-[var(--surface)] ${
              row.active ? 'border-[var(--border)]' : 'border-dashed border-[var(--border)] opacity-70'
            }`}
          >
            <div className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-[180px] flex-1">
                <p className="text-sm font-semibold">
                  {row.name}
                  {row.active ? null : (
                    <span className="ml-2 rounded border border-[var(--border)] px-1.5 py-0.5 text-xs font-normal text-[var(--muted)]">
                      inactiva
                    </span>
                  )}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {[row.legalName, row.taxId ? `EIN ${row.taxId}` : null, row.contactName]
                    .filter(Boolean)
                    .join(' · ') || 'sin datos adicionales'}
                </p>
              </div>

              <div className="text-right">
                <p className="text-sm tabular-nums">${currency(row.paidTotal)}</p>
                <p className="text-xs text-[var(--muted)]">
                  {row.orderCount} orden(es)
                  {row.pendingCount > 0 ? ` · ${row.pendingCount} sin pagar` : ''}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setEditing(editing === row.id ? null : row.id)}
                className="rounded border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--hover)]"
              >
                {editing === row.id ? 'cerrar' : 'editar'}
              </button>

              <form action={toggle}>
                <input type="hidden" name="recipientId" value={row.id} />
                <input type="hidden" name="active" value={row.active ? '0' : '1'} />
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--hover)] disabled:opacity-45"
                >
                  {row.active ? 'desactivar' : 'activar'}
                </button>
              </form>
            </div>

            {editing === row.id ? (
              <div className="border-t border-[var(--border)] p-3">
                <RecipientForm mode="edit" values={row} onDone={() => setEditing(null)} />
                {row.orderCount > 0 ? (
                  <p className="mt-3 text-xs text-[var(--muted)]">
                    Esta empresa ya tiene {row.orderCount} orden(es) de desembolso. Cambiarle el
                    nombre no altera los documentos ya emitidos: cada orden guarda el nombre con
                    el que se emitió.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
