'use client'

import { useActionState, useMemo, useState } from 'react'
import {
  checkBalance,
  groupByRecipient,
  type PayableToGroup,
} from '@/lib/disbursement/grouping'
import { ZERO, add, toCents, toDecimalString } from '@/lib/payroll/engine/money'
import { AssignRecipient, type RecipientOption } from './AssignRecipient'
import { approvePayrolls, rejectPayrolls } from './actions'

export interface ApprovalRow {
  id: string
  workerId: string
  workerName: string
  weekLabel: string
  weekId: string
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
  recipientId: string | null
  recipientName: string | null
  /** Receptora de la semana pasada — solo propuesta, jamás asignación (BR-181). */
  suggestedRecipientId: string | null
  suggestedRecipientName: string | null
}

/** Liquidación de una cuadrilla esperando aprobación: se paga al contratista. */
export interface CrewApprovalRow {
  id: string
  name: string
  contractorName: string | null
  hasContractor: boolean
  weekId: string
  weekLabel: string
  period: string
  productionCount: number
  total: string
  recipientId: string | null
  recipientName: string | null
  suggestedRecipientId: string | null
  suggestedRecipientName: string | null
  /** Saldo vivo de préstamos del crew o su contratista — solo aviso. */
  loanBalance: string | null
  preparedByMe: boolean
  wasInvalidated: boolean
  exceptions: Array<{ level: string; title: string; detail: string | null }>
}

function currency(value: string): string {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function ApprovalPanel({
  rows,
  crewRows,
  threshold,
  recipients,
}: {
  rows: readonly ApprovalRow[]
  crewRows: readonly CrewApprovalRow[]
  threshold: number
  recipients: readonly RecipientOption[]
}) {
  const approvable = rows.filter((row) => !row.preparedByMe)
  const approvableCrews = crewRows.filter((row) => !row.preparedByMe)
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(approvable.map((row) => row.id)),
  )
  const [selectedCrews, setSelectedCrews] = useState<ReadonlySet<string>>(
    () => new Set(approvableCrews.map((row) => row.id)),
  )
  const [choice, setChoice] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
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
  const selectedIds = selectedRows.map((row) => row.id)
  const selectedCrewRows = crewRows.filter((row) => selectedCrews.has(row.id))
  const selectedCrewIds = selectedCrewRows.map((row) => row.id)

  const toggleCrew = (id: string) => {
    setSelectedCrews((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /*
   * El resumen se calcula con la misma función que usa el servidor al generar
   * las órdenes, y en centavos enteros — personas y cuadrillas juntas. Si la
   * pantalla sumara por su cuenta en coma flotante, podría mostrar un total y
   * guardarse otro.
   */
  const summary = useMemo(() => {
    const payables: PayableToGroup[] = [
      ...selectedRows.map((row) => ({
        kind: 'WORKER' as const,
        payableId: row.id,
        refId: row.workerId,
        name: row.workerName,
        crewLabel: null,
        payrollWeekId: row.weekId,
        amount: row.net,
        recipientId: row.recipientId,
        recipientName: row.recipientName,
      })),
      ...selectedCrewRows.map((row) => ({
        kind: 'CREW' as const,
        payableId: row.id,
        refId: row.id,
        name: `Cuadrilla ${row.name}${row.contractorName ? ` → ${row.contractorName}` : ''}`,
        crewLabel: row.name,
        payrollWeekId: row.weekId,
        amount: row.total,
        recipientId: row.recipientId,
        recipientName: row.recipientName,
      })),
    ]
    const grouped = groupByRecipient(payables)

    const approvedTotal = payables.reduce(
      (accumulator, row) => add(accumulator, toCents(row.amount)),
      ZERO,
    )
    const balance = checkBalance(approvedTotal, grouped.groups)
    const weekByRow = new Map([
      ...rows.map((row) => [row.weekId, { weekLabel: row.weekLabel, period: row.period }] as const),
      ...crewRows.map(
        (row) => [row.weekId, { weekLabel: row.weekLabel, period: row.period }] as const,
      ),
    ])

    return {
      groups: grouped.groups.map((group) => ({
        ...group,
        weekLabel: weekByRow.get(group.payrollWeekId)?.weekLabel ?? '',
        period: weekByRow.get(group.payrollWeekId)?.period ?? '',
      })),
      unassigned: grouped.unassigned,
      grandTotal: toDecimalString(grouped.grandTotal),
      approvedTotal: toDecimalString(approvedTotal),
      balanced: balance.balanced && grouped.unassigned.length === 0,
      balanceMessage: balance.message,
    }
  }, [rows, crewRows, selectedRows, selectedCrewRows])

  const blocked = summary.unassigned.length > 0 || !summary.balanced

  /*
   * Sugerencias agrupadas: "estos 12 iban a FORZO la semana pasada". El botón
   * solo MARCA esas filas y precarga la receptora en la barra; el dinero no se
   * mueve hasta que el aprobador oprima «Asignar». Reemplaza la selección (no
   * la suma): sumarla asignaría la sugerencia a gente que ya tiene otra
   * receptora bien puesta.
   */
  const suggestions = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; rowIds: string[] }>()
    for (const row of rows) {
      if (row.preparedByMe || row.recipientId) continue
      if (!row.suggestedRecipientId || !row.suggestedRecipientName) continue
      const group = groups.get(row.suggestedRecipientId) ?? {
        id: row.suggestedRecipientId,
        name: row.suggestedRecipientName,
        rowIds: [],
      }
      group.rowIds.push(row.id)
      groups.set(row.suggestedRecipientId, group)
    }
    return [...groups.values()]
  }, [rows])

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

      <div className="mb-4">
        <AssignRecipient
          recipients={recipients}
          selectedIds={selectedIds}
          selectedCrewIds={selectedCrewIds}
          selectedCount={selectedIds.length + selectedCrewIds.length}
          choice={choice}
          onChoiceChange={setChoice}
        />

        {suggestions.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
            <span className="font-medium">Como la semana pasada:</span>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                onClick={() => {
                  setSelected(new Set(suggestion.rowIds))
                  setChoice(suggestion.id)
                }}
                className="rounded-md border border-sky-300 bg-white px-2.5 py-1 font-medium hover:bg-sky-100"
              >
                Marcar {suggestion.rowIds.length} de {suggestion.name}
              </button>
            ))}
            <span className="text-sky-800">
              — deja marcadas y precargada la receptora; tú confirmas con «Asignar».
            </span>
          </div>
        ) : null}
      </div>

      <form>
        {crewRows.length > 0 ? (
          <div className="mb-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Cuadrillas — se paga al contratista
            </p>
            {crewRows.map((row) => {
              const isSelected = selectedCrews.has(row.id)
              return (
                <div
                  key={row.id}
                  className={`rounded-lg border bg-[var(--surface)] ${
                    !row.recipientId && isSelected ? 'border-sky-300' : 'border-[var(--border)]'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3 p-3">
                    <input
                      type="checkbox"
                      name="crewPayrollId"
                      value={row.id}
                      checked={isSelected}
                      onChange={() => toggleCrew(row.id)}
                      disabled={row.preparedByMe}
                      className="h-4 w-4 shrink-0"
                    />

                    <div className="min-w-[160px] flex-1">
                      <p className="text-sm font-semibold">Cuadrilla {row.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {row.weekLabel} · {row.productionCount} registro(s) de producción ·{' '}
                        {row.contractorName ? (
                          <>cobra <strong>{row.contractorName}</strong></>
                        ) : (
                          <span className="font-medium text-red-700">sin contratista</span>
                        )}
                      </p>
                    </div>

                    <div className="min-w-[150px]">
                      {row.recipientName ? (
                        <>
                          <p className="text-xs text-[var(--muted)]">se le paga a</p>
                          <p className="text-sm font-medium">{row.recipientName}</p>
                        </>
                      ) : (
                        <>
                          <span className="inline-block rounded border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-900">
                            falta empresa receptora
                          </span>
                          {row.suggestedRecipientName ? (
                            <p className="mt-0.5 text-xs text-[var(--muted)]">
                              semana pasada: {row.suggestedRecipientName}
                            </p>
                          ) : null}
                        </>
                      )}
                    </div>

                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">${currency(row.total)}</p>
                      <p className="text-xs text-[var(--muted)]">producción de la semana</p>
                    </div>
                  </div>

                  {row.loanBalance ? (
                    <p className="border-t border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <strong>Préstamo pendiente: ${currency(row.loanBalance)}</strong> del crew o
                      su contratista. Solo aviso — el descuento se registra en Préstamos.
                    </p>
                  ) : null}

                  {row.wasInvalidated ? (
                    <p className="border-t border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Ya estaba aprobada y su producción cambió después. Hay que revisarla de nuevo.
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
                    </p>
                  ))}
                </div>
              )
            })}
          </div>
        ) : null}

        <div className="space-y-2">
          {rows.map((row) => {
            const varied = row.changePct !== null && Math.abs(row.changePct) > threshold
            const attention = row.exceptions.length > 0 || row.isNew || row.wasInvalidated || varied
            const critical = row.exceptions.some((item) => item.level === 'CRITICAL')
            const isOpen = expanded === row.id
            const isSelected = selected.has(row.id)

            return (
              <div
                key={row.id}
                className={`rounded-lg border bg-[var(--surface)] ${
                  critical
                    ? 'border-red-300'
                    : !row.recipientId && isSelected
                      ? 'border-sky-300'
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
                    checked={isSelected}
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

                  {/* A dónde va el dinero de esta persona */}
                  <div className="min-w-[150px]">
                    {row.recipientName ? (
                      <>
                        <p className="text-xs text-[var(--muted)]">se le paga a</p>
                        <p className="text-sm font-medium">{row.recipientName}</p>
                      </>
                    ) : (
                      <>
                        <span className="inline-block rounded border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-900">
                          falta empresa receptora
                        </span>
                        {row.suggestedRecipientName ? (
                          <p className="mt-0.5 text-xs text-[var(--muted)]">
                            semana pasada: {row.suggestedRecipientName}
                          </p>
                        ) : null}
                      </>
                    )}
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
                    <Row label="Se le paga a" value={row.recipientName ?? 'sin asignar'} />
                  </dl>
                ) : null}
              </div>
            )
          })}
        </div>

        {/* ── Resumen antes de confirmar ─────────────────────── */}
        {reviewing ? (
          <section className="mt-5 rounded-lg border-2 border-[var(--accent)] bg-[var(--surface)] p-4">
            <h2 className="text-base font-semibold">Esto es lo que vas a ordenar desembolsar</h2>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              Una orden por empresa receptora. Revisa que cada persona esté donde debe.
            </p>

            {summary.unassigned.length > 0 ? (
              <p className="mt-3 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
                <strong>
                  {summary.unassigned.length} sin empresa receptora:
                </strong>{' '}
                {summary.unassigned.map((item) => item.name).join(', ')}. Asígnalas arriba
                antes de aprobar.
              </p>
            ) : null}

            {!summary.balanced && summary.balanceMessage ? (
              <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                {summary.balanceMessage}
              </p>
            ) : null}

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {summary.groups.map((group) => (
                <div
                  key={`${group.payrollWeekId}:${group.recipientId}`}
                  className="rounded-lg border border-[var(--border)] p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{group.recipientName}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {group.weekLabel} · {group.items.length} renglón(es)
                      </p>
                    </div>
                    <p className="text-lg font-semibold tabular-nums">
                      ${currency(toDecimalString(group.total))}
                    </p>
                  </div>

                  <ul className="mt-2.5 space-y-1 border-t border-[var(--border)] pt-2.5">
                    {group.items.map((item) => (
                      <li
                        key={item.payableId}
                        className="flex justify-between gap-3 text-sm"
                      >
                        <span>{item.name}</span>
                        <span className="tabular-nums text-[var(--muted)]">
                          ${currency(toDecimalString(item.amount))}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-2.5 flex justify-between border-t border-[var(--border)] pt-2.5 text-sm font-semibold">
                    <span>TOTAL A DESEMBOLSAR</span>
                    <span className="tabular-nums">
                      ${currency(toDecimalString(group.total))}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t-2 border-[var(--border)] pt-3">
              <span className="text-sm font-semibold uppercase tracking-wide">
                Total general de la nómina
              </span>
              <span className="text-2xl font-semibold tabular-nums">
                ${currency(summary.approvedTotal)}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {summary.groups.length} orden(es) de desembolso · suman ${currency(summary.grandTotal)}
              {summary.balanced ? ' · cuadra con lo aprobado' : ''}
            </p>
          </section>
        ) : null}

        <div className="sticky bottom-0 mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <strong>{selected.size + selectedCrews.size}</strong> marcada(s) ·{' '}
              <strong className="tabular-nums">${currency(summary.approvedTotal)}</strong>
              {summary.unassigned.length > 0 ? (
                <span className="ml-2 text-sky-800">
                  · {summary.unassigned.length} sin empresa receptora
                </span>
              ) : null}
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
                disabled={selected.size + selectedCrews.size === 0}
                className="h-9 rounded-md border border-red-300 px-3.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-45"
              >
                Rechazar
              </button>

              {reviewing ? (
                <>
                  <button
                    type="button"
                    onClick={() => setReviewing(false)}
                    className="h-9 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)]"
                  >
                    Seguir revisando
                  </button>
                  <button
                    type="submit"
                    formAction={approveAction}
                    disabled={selected.size + selectedCrews.size === 0 || blocked}
                    title={
                      blocked
                        ? 'Falta asignar la empresa receptora de todas las personas marcadas'
                        : undefined
                    }
                    className="h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
                  >
                    Confirmar y generar {summary.groups.length} orden(es)
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setReviewing(true)}
                  disabled={selected.size + selectedCrews.size === 0}
                  className="h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
                >
                  Revisar y aprobar{' '}
                  {selected.size + selectedCrews.size > 0
                    ? `(${selected.size + selectedCrews.size})`
                    : ''}
                </button>
              )}
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
