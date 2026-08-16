'use client'

import { useActionState } from 'react'
import { TIPO_REPORTE } from '@/lib/mail/reports'
import { addReportRecipient, toggleReportRecipient } from './actions'

export interface RecipientRow {
  id: string
  name: string
  email: string
  kinds: readonly string[]
  paymentRecipientName: string | null
  bcc: boolean
  active: boolean
}

function Aviso({ result }: { result: string | null }) {
  if (!result) return null
  const ok = result.startsWith('LISTO|')
  return (
    <p
      className={`mb-3 rounded-md border p-2.5 text-sm ${
        ok
          ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
          : 'border-amber-300 bg-amber-50 text-amber-900'
      }`}
    >
      {result.replace(/^LISTO\|/, '')}
    </p>
  )
}

/**
 * Agregar a quién se le mandan los reportes.
 *
 * Dos formas, que son los dos casos que pidió el negocio: general (la auxiliar
 * contable, que recibe todo) o atado a una empresa receptora (que recibe SOLO
 * sus órdenes — a un contratista no se le manda el desprendible de otro).
 */
export function AddRecipientForm({
  paymentRecipients,
}: {
  paymentRecipients: ReadonlyArray<{ id: string; name: string }>
}) {
  const [result, action, saving] = useActionState(addReportRecipient, null)

  return (
    <form
      action={action}
      className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <Aviso result={result} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Nombre</span>
          <input
            name="name"
            required
            placeholder="Auxiliar contable"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Correo</span>
          <input
            name="email"
            type="email"
            required
            placeholder="contabilidad@empresa.com"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">¿De qué empresa receptora?</span>
          <select
            name="paymentRecipientId"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
          >
            <option value="">Todas — recibe todo</option>
            {paymentRecipients.map((r) => (
              <option key={r.id} value={r.id}>
                Solo las de {r.name}
              </option>
            ))}
          </select>
          <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
            Si eliges una, solo recibe SUS órdenes.
          </span>
        </label>

        <fieldset className="text-sm">
          <legend className="mb-1 block text-[var(--muted)]">Qué recibe</legend>
          <div className="space-y-1">
            {Object.entries(TIPO_REPORTE).map(([code, etiqueta]) => (
              <label key={code} className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="kinds" value={code} className="h-3.5 w-3.5" />
                {etiqueta}
              </label>
            ))}
            <span className="block text-[11px] text-[var(--muted)]">
              Sin marcar nada, recibe todo.
            </span>
          </div>
        </fieldset>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" name="bcc" className="h-4 w-4" />
        <span>
          Copia oculta
          <span className="ml-1 text-xs text-[var(--muted)]">
            — los demás no ven que también le llegó
          </span>
        </span>
      </label>

      <button
        type="submit"
        disabled={saving}
        className="brand-gradient mt-4 inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-45"
      >
        {saving ? 'Guardando…' : 'Agregar destinatario'}
      </button>
    </form>
  )
}

/** Activar o desactivar un destinatario. Nunca se borra: hay envíos que lo citan. */
export function ToggleRecipient({ row }: { row: RecipientRow }) {
  const [result, action, saving] = useActionState(toggleReportRecipient, null)

  return (
    <form action={action}>
      <input type="hidden" name="id" value={row.id} />
      <button
        type="submit"
        disabled={saving}
        className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-45"
        title={
          row.active
            ? 'Deja de recibir reportes. No se borra: los envíos ya hechos lo citan.'
            : 'Vuelve a recibir reportes.'
        }
      >
        {saving ? '…' : row.active ? 'desactivar' : 'activar'}
      </button>
      {result && !result.startsWith('LISTO|') ? (
        <span className="ml-2 text-xs text-amber-800">{result}</span>
      ) : null}
    </form>
  )
}
