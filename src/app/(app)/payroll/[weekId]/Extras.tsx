'use client'

import { useActionState, useState } from 'react'
import { ADICIONAL, DESCUENTO, type ExtraRow } from '@/lib/payroll/extras'
import { addWeekExtra, removeWeekExtra } from '../actions'

export interface ExtraWorker {
  id: string
  name: string
}

function currency(value: string): string {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Descuentos y adicionales de la semana.
 *
 * El hotel, la herramienta prestada, el bono. Todo lo que cambia lo que alguien
 * recibe pero no es un día trabajado.
 *
 * Se separan visualmente en dos columnas —lo que suma y lo que resta— porque la
 * pregunta al revisar es «¿por qué le queda menos?», y mezclarlos obliga a leer
 * cada línea para saber de qué lado está.
 */
export function Extras({
  weekId,
  workers,
  rows,
  additionsTotal,
  deductionsTotal,
  days,
}: {
  weekId: string
  workers: readonly ExtraWorker[]
  rows: readonly ExtraRow[]
  additionsTotal: string
  deductionsTotal: string
  days: readonly string[]
}) {
  const [open, setOpen] = useState(rows.length > 0)
  const [kind, setKind] = useState<'DEDUCTION' | 'ADDITION'>('DEDUCTION')

  const [addResult, addAction, saving] = useActionState(addWeekExtra, null)
  const [removeResult, removeAction] = useActionState(removeWeekExtra, null)

  const result = addResult ?? removeResult
  const ok = result !== null && result.startsWith('LISTO|')

  const additions = rows.filter((row) => row.kind === 'ADDITION')
  const deductions = rows.filter((row) => row.kind === 'DEDUCTION')
  const categories = kind === 'ADDITION' ? ADICIONAL : DESCUENTO

  const net = Number(additionsTotal) - Number(deductionsTotal)

  return (
    <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--hover)]"
      >
        <div>
          <h2 className="text-sm font-semibold">Descuentos y adicionales de la semana</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Hotel, equipo, herramienta, bonos — lo que no es un día trabajado.
          </p>
        </div>
        <div className="text-right">
          {rows.length === 0 ? (
            <span className="text-sm text-[var(--muted)]">
              {open ? 'ocultar' : 'nada anotado · agregar'}
            </span>
          ) : (
            <>
              <p className="text-sm tabular-nums">
                <span className="text-emerald-700">+${currency(additionsTotal)}</span>
                {'  '}
                <span className="text-red-700">−${currency(deductionsTotal)}</span>
              </p>
              <p className="text-xs text-[var(--muted)] tabular-nums">
                efecto neto {net >= 0 ? '+' : '−'}${currency(String(Math.abs(net)))} ·{' '}
                {open ? 'ocultar' : 'ver'}
              </p>
            </>
          )}
        </div>
      </button>

      {open ? (
        <div className="border-t border-[var(--border)] p-4">
          {result ? (
            <p
              className={`mb-3 rounded-md border p-2.5 text-sm ${
                ok
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : 'border-amber-300 bg-amber-50 text-amber-900'
              }`}
            >
              {result.replace(/^LISTO\|/, '')}
            </p>
          ) : null}

          {/* ── Anotar uno nuevo ─────────────────────────────── */}
          <form action={addAction} className="rounded-md border border-[var(--border)] bg-[var(--hover)] p-3">
            <input type="hidden" name="weekId" value={weekId} />

            <div className="mb-2.5 flex gap-2">
              {(['DEDUCTION', 'ADDITION'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setKind(option)}
                  className={`h-8 rounded-full px-3.5 text-sm transition ${
                    kind === option
                      ? option === 'DEDUCTION'
                        ? 'bg-red-600 font-medium text-white'
                        : 'bg-emerald-600 font-medium text-white'
                      : 'border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--hover)]'
                  }`}
                >
                  {option === 'DEDUCTION' ? '− Se le descuenta' : '+ Se le suma'}
                </button>
              ))}
            </div>
            <input type="hidden" name="kind" value={kind} />

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <label className="block lg:col-span-2">
                <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
                  ¿A quién?<span className="text-red-600"> *</span>
                </span>
                <select
                  name="workerId"
                  required
                  className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                >
                  <option value="">— escoge la persona —</option>
                  {workers.map((worker) => (
                    <option key={worker.id} value={worker.id}>
                      {worker.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Concepto</span>
                <select
                  name="category"
                  className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                >
                  {Object.entries(categories).map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
                  Monto<span className="text-red-600"> *</span>
                </span>
                <input
                  name="amount"
                  required
                  placeholder="120.00"
                  inputMode="decimal"
                  className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
                  Día (opcional)
                </span>
                <select
                  name="workDate"
                  className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                >
                  <option value="">toda la semana</option>
                  {days.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="block min-w-[240px] flex-1">
                <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
                  ¿De qué se trata?<span className="text-red-600"> *</span>
                </span>
                <input
                  name="description"
                  required
                  placeholder="Hotel semana 33 · 2 noches"
                  className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={saving}
                className="h-9 rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
              >
                {saving ? 'Guardando…' : 'Anotar'}
              </button>
            </div>

            <p className="mt-2 text-xs text-[var(--muted)]">
              Sin explicación no se guarda: meses después nadie se acuerda de por qué se descontó.
              Tras anotarlo hay que <strong>volver a calcular</strong> para que entre al pago.
            </p>
          </form>

          {/* ── Lo ya anotado ────────────────────────────────── */}
          {rows.length > 0 ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ExtraList
                title="Se le descuenta"
                tone="red"
                rows={deductions}
                total={deductionsTotal}
                weekId={weekId}
                onRemove={removeAction}
              />
              <ExtraList
                title="Se le suma"
                tone="green"
                rows={additions}
                total={additionsTotal}
                weekId={weekId}
                onRemove={removeAction}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function ExtraList({
  title,
  tone,
  rows,
  total,
  weekId,
  onRemove,
}: {
  title: string
  tone: 'red' | 'green'
  rows: readonly ExtraRow[]
  total: string
  weekId: string
  onRemove: (formData: FormData) => void
}) {
  const color = tone === 'red' ? 'text-red-700' : 'text-emerald-700'

  return (
    <div className="rounded-md border border-[var(--border)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <span className="brand-label text-[var(--muted)]">{title}</span>
        <span className={`text-sm font-semibold tabular-nums ${color}`}>
          {tone === 'red' ? '−' : '+'}${currency(total)}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-[var(--muted)]">Nada anotado.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-sm last:border-0"
            >
              <div className="min-w-[140px] flex-1">
                <p className="font-medium">{row.workerName}</p>
                <p className="text-xs text-[var(--muted)]">
                  {row.categoryLabel} · {row.description}
                  {row.workDate ? ` · ${row.workDate}` : ''}
                </p>
              </div>
              <span className={`tabular-nums ${color}`}>${currency(row.amount)}</span>

              {row.removable ? (
                <form action={onRemove}>
                  <input type="hidden" name="weekId" value={weekId} />
                  <input type="hidden" name="kind" value={row.kind} />
                  <input type="hidden" name="extraId" value={row.id} />
                  <button
                    type="submit"
                    className="rounded border border-[var(--border)] px-2 py-0.5 text-xs hover:bg-[var(--hover)]"
                  >
                    quitar
                  </button>
                </form>
              ) : (
                <span
                  className="text-xs text-[var(--muted)]"
                  title={
                    row.locked
                      ? 'La nómina ya salió a aprobación'
                      : 'Lo generó el sistema desde un préstamo'
                  }
                >
                  {row.locked ? 'en aprobación' : 'del sistema'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
