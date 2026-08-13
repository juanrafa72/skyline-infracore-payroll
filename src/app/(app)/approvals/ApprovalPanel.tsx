'use client'

import { useActionState, useState } from 'react'
import { approvePayrolls, rejectPayrolls } from './actions'

export interface ApprovalRow {
  id: string
  workerName: string
  weekLabel: string
  period: string
  daysFull: number
  daysHalf: number
  rate: string | null
  basePay: string
  additions: string
  additionDetails: string[]
  deductions: string
  deductionDetails: string[]
  gross: string
  net: string
  previousNet: string | null
  previousDays: number | null
  changePct: number | null
  isNew: boolean
  preparedByMe: boolean
  exceptions: Array<{ level: string; title: string; detail: string | null }>
  wasInvalidated: boolean
}

function currency(value: string): string {
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function ApprovalPanel({
  rows,
  threshold,
}: {
  rows: readonly ApprovalRow[]
  threshold: number
}) {
  const approvable = rows.filter((row) => !row.preparedByMe)
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(approvable.map((row) => row.id)),
  )
  const [expanded, setExpanded] = useState<string | null>(null)
  const [approveResult, approveAction] = useActionState(approvePayrolls, null)
  const [rejectResult, rejectAction] = useActionState(rejectPayrolls, null)

  const result = approveResult ?? rejectResult
  const ok = result?.startsWith('LISTO|')

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedRows = rows.filter((row) => selected.has(row.id))
  const selectedNet = selectedRows.reduce((sum, row) => sum + Number(row.net), 0)

  return (
    <>
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

      <form>
        <div className="space-y-2">
          {rows.map((row) => {
            const varied = row.changePct !== null && Math.abs(row.changePct) > threshold
            const attention = row.exceptions.length > 0 || row.isNew || row.wasInvalidated || varied
            const critical = row.exceptions.some((item) => item.level === 'CRITICAL')
            const isOpen = expanded === row.id

            return (
              <div
                key={row.id}
                className={`rounded-lg border bg-[var(--surface)] ${
                  critical
                    ? 'border-red-300'
                    : attention
                      ? 'border-amber-300'
                      : 'border-[var(--border)]'
                }`}
              >
                <div className="flex flex-wrap items-center gap-3 p-3">
                  <input
                    type="checkbox"
                    name="payrollId"
                    value={row.id}
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                    disabled={row.preparedByMe}
                    className="h-4 w-4 shrink-0"
                    title={
                      row.preparedByMe
                        ? 'La preparaste tú: debe aprobarla otra persona'
                        : undefined
                    }
                  />

                  <div className="min-w-[160px] flex-1">
                    <p className="text-sm font-semibold">{row.workerName}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {row.weekLabel} · {row.daysFull} días
                      {row.daysHalf > 0 ? ` + ${row.daysHalf} medio(s)` : ''}
                      {row.rate ? ` · $${currency(row.rate)}/día` : ''}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">${currency(row.net)}</p>
                    <p className="text-xs text-[var(--muted)] tabular-nums">
                      bruto ${currency(row.gross)}
                      {Number(row.deductions) > 0 ? ` − ${currency(row.deductions)}` : ''}
                    </p>
                  </div>

                  <div className="min-w-[110px] text-right">
                    {row.isNew ? (
                      <span className="rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-800">
                        primera vez
                      </span>
                    ) : row.changePct === null ? (
                      <span className="text-xs text-[var(--muted)]">sin comparación</span>
                    ) : (
                      <span
                        className={`text-xs font-medium tabular-nums ${
                          varied ? 'text-amber-700' : 'text-[var(--muted)]'
                        }`}
                      >
                        {row.changePct > 0 ? '▲' : row.changePct < 0 ? '▼' : '='}{' '}
                        {Math.abs(row.changePct).toFixed(0)}% vs ${currency(row.previousNet ?? '0')}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : row.id)}
                    className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--hover)]"
                  >
                    {isOpen ? 'ocultar' : 'detalle'}
                  </button>
                </div>

                {row.preparedByMe ? (
                  <p className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
                    La preparaste tú. Debe aprobarla otra persona.
                  </p>
                ) : null}

                {row.wasInvalidated ? (
                  <p className="border-t border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Ya estaba aprobada y algo cambió después. Hay que revisarla de nuevo.
                  </p>
                ) : null}

                {row.exceptions.map((exception, index) => (
                  <p
                    key={index}
                    className={`border-t px-3 py-2 text-xs ${
                      exception.level === 'CRITICAL'
                        ? 'border-red-300 bg-red-50 text-red-800'
                        : 'border-amber-300 bg-amber-50 text-amber-900'
                    }`}
                  >
                    <strong>{exception.title}</strong>
                    {exception.detail ? ` — ${exception.detail}` : ''}
                    {exception.level === 'CRITICAL'
                      ? ' · Bloquea la aprobación hasta resolverlo.'
                      : ''}
                  </p>
                ))}

                {isOpen ? (
                  <dl className="grid gap-x-6 gap-y-1 border-t border-[var(--border)] px-3 py-3 text-xs sm:grid-cols-2">
                    <Row label="Periodo" value={row.period} />
                    <Row label="Pago base" value={`$${currency(row.basePay)}`} />
                    <Row
                      label="Adicionales"
                      value={
                        row.additionDetails.length > 0
                          ? row.additionDetails.join(' · ')
                          : `$${currency(row.additions)}`
                      }
                    />
                    <Row
                      label="Descuentos"
                      value={
                        row.deductionDetails.length > 0
                          ? row.deductionDetails.join(' · ')
                          : `$${currency(row.deductions)}`
                      }
                    />
                    <Row
                      label="Semana anterior"
                      value={
                        row.previousNet
                          ? `$${currency(row.previousNet)} · ${row.previousDays ?? 0} días`
                          : 'sin semana anterior'
                      }
                    />
                  </dl>
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="sticky bottom-0 mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <strong>{selected.size}</strong> marcada(s) ·{' '}
              <strong className="tabular-nums">
                ${selectedNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </strong>
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <input
                name="reason"
                placeholder="Motivo (obligatorio para rechazar)"
                className="h-9 min-w-[220px] flex-1 rounded-md border border-[var(--border)] px-2.5 text-sm"
              />
              <button
                type="submit"
                formAction={rejectAction}
                disabled={selected.size === 0}
                className="h-9 rounded-md border border-red-300 px-3.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-45"
              >
                Rechazar
              </button>
              <button
                type="submit"
                formAction={approveAction}
                disabled={selected.size === 0}
                className="h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
              >
                Aprobar {selected.size > 0 ? `(${selected.size})` : ''}
              </button>
            </div>
          </div>
        </div>
      </form>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[var(--border)] py-1 last:border-0">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  )
}
