'use client'

import { useActionState, useState } from 'react'
import type { AdvanceRow } from '@/lib/advances/service'
import { ESTADO_PRESTAMO, TIPO_BENEFICIARIO } from '@/lib/advances'
import {
  approveAdvanceAction,
  cancelAdvanceAction,
  createAdvanceAction,
  recordRepaymentAction,
} from './actions'

export interface Beneficiary {
  id: string
  name: string
  type: 'WORKER' | 'CONTRACTOR' | 'CREW' | 'RECIPIENT'
}

function currency(value: string): string {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Préstamos: lista con saldo, y el formulario para crear uno nuevo.
 *
 * El saldo se muestra siempre junto a lo prestado y con una barra: la pregunta
 * que la gente hace mirando esta pantalla no es «cuánto le presté» sino
 * «cuánto me debe todavía».
 */
export function AdvancePanel({
  rows,
  beneficiaries,
  canApprove,
  today,
}: {
  rows: readonly AdvanceRow[]
  beneficiaries: readonly Beneficiary[]
  canApprove: boolean
  today: string
}) {
  const [tipo, setTipo] = useState<Beneficiary['type']>('WORKER')
  const [metodo, setMetodo] = useState('FIXED_WEEKLY')
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const [createResult, create, saving] = useActionState(createAdvanceAction, null)
  const [approveResult, approve] = useActionState(approveAdvanceAction, null)
  const [cancelResult, cancel] = useActionState(cancelAdvanceAction, null)
  const [payResult, pay] = useActionState(recordRepaymentAction, null)

  const result = createResult ?? approveResult ?? cancelResult ?? payResult
  const ok = result !== null && result.startsWith('LISTO|')

  const delTipo = beneficiaries.filter((b) => b.type === tipo)

  const term = query.trim().toLowerCase()
  const visibles = term
    ? rows.filter(
        (row) =>
          row.beneficiaryName.toLowerCase().includes(term) ||
          row.reason.toLowerCase().includes(term),
      )
    : rows

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div>
        {result ? (
          <p
            className={`mb-3 rounded-md border p-3 text-sm ${
              ok
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                : 'border-amber-300 bg-amber-50 text-amber-900'
            }`}
          >
            {result.replace(/^LISTO\|/, '')}
          </p>
        ) : null}

        {rows.length > 0 ? (
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por beneficiario o motivo"
            className="mb-3 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm"
          />
        ) : null}

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center">
            <p className="font-medium">Todavía no hay préstamos</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Aquí va la plata que se le adelanta a alguien y se le va descontando. Al llegar la
              semana, el descuento aparece solo en su pago.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibles.map((row) => {
              const abierto = abriendo === row.id
              const pagado = row.status === 'PAID'
              const anulado = row.status === 'CANCELLED'

              return (
                <div
                  key={row.id}
                  className={`rounded-lg border bg-[var(--surface)] ${
                    anulado
                      ? 'border-dashed border-[var(--border)] opacity-70'
                      : pagado
                        ? 'border-emerald-300'
                        : row.status === 'PENDING'
                          ? 'border-sky-300'
                          : 'border-[var(--border)]'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3 p-3">
                    <div className="min-w-[180px] flex-1">
                      <p className="text-sm font-semibold">
                        {row.beneficiaryName}
                        <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                          {TIPO_BENEFICIARIO[row.beneficiaryType]}
                        </span>
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {row.reason} · {row.requestDate}
                      </p>
                    </div>

                    <div className="min-w-[140px]">
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--hover)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent)]"
                          style={{ width: `${row.progress}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {row.planLabel}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-xs text-[var(--muted)]">debe</p>
                      <p className="text-base font-semibold tabular-nums">
                        ${currency(row.balance)}
                      </p>
                      <p className="text-xs text-[var(--muted)] tabular-nums">
                        de ${currency(row.amount)}
                      </p>
                    </div>

                    <span
                      className={`rounded border px-2 py-0.5 text-xs font-medium ${
                        pagado
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                          : row.status === 'PENDING'
                            ? 'border-sky-300 bg-sky-50 text-sky-900'
                            : 'border-[var(--border)] text-[var(--muted)]'
                      }`}
                    >
                      {ESTADO_PRESTAMO[row.status]}
                    </span>

                    <button
                      type="button"
                      onClick={() => setAbriendo(abierto ? null : row.id)}
                      className="rounded border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--hover)]"
                    >
                      {abierto ? 'cerrar' : 'detalle'}
                    </button>
                  </div>

                  {row.status === 'PENDING' && canApprove ? (
                    <div className="flex flex-wrap items-center gap-2 border-t border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                      <span>
                        {row.requestedByMe
                          ? 'Lo pediste tú: debe aprobarlo otra persona.'
                          : 'Esperando aprobación para poder descontarse.'}
                      </span>
                      {row.requestedByMe ? null : (
                        <form action={approve}>
                          <input type="hidden" name="advanceId" value={row.id} />
                          <button
                            type="submit"
                            className="rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white hover:opacity-90"
                          >
                            Aprobar
                          </button>
                        </form>
                      )}
                    </div>
                  ) : null}

                  {abierto ? (
                    <div className="space-y-3 border-t border-[var(--border)] p-3">
                      {row.recoveries.length > 0 ? (
                        <div>
                          <p className="brand-label mb-1.5 text-[var(--muted)]">Abonos</p>
                          <ul className="space-y-0.5 text-xs">
                            {row.recoveries.map((r, index) => (
                              <li key={index} className="flex justify-between gap-3">
                                <span>
                                  {r.when} · {r.notes ?? 'descuento de nómina'}
                                </span>
                                <span className="tabular-nums">${currency(r.amount)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--muted)]">Sin abonos todavía.</p>
                      )}

                      {!pagado && !anulado && row.status !== 'PENDING' ? (
                        <form action={pay} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                          <input type="hidden" name="advanceId" value={row.id} />
                          <input
                            name="amount"
                            required
                            placeholder="Monto del abono"
                            className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm"
                          />
                          <input
                            name="notes"
                            placeholder="Cómo lo pagó (efectivo, transferencia…)"
                            className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm"
                          />
                          <button
                            type="submit"
                            className="h-9 rounded-full border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)]"
                          >
                            Registrar abono
                          </button>
                        </form>
                      ) : null}

                      {row.recoveries.length === 0 && !anulado && canApprove ? (
                        <form action={cancel} className="grid gap-2 sm:grid-cols-[2fr_auto]">
                          <input type="hidden" name="advanceId" value={row.id} />
                          <input
                            name="reason"
                            required
                            placeholder="Por qué se anula"
                            className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm"
                          />
                          <button
                            type="submit"
                            className="h-9 rounded-full border border-red-300 px-3 text-sm text-red-700 hover:bg-red-50"
                          >
                            Anular
                          </button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Nuevo préstamo ────────────────────────────────────── */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold">Nuevo préstamo</h2>
        <p className="mb-3 mt-1 text-xs text-[var(--muted)]">
          Se descuenta solo cuando llegue la semana, según el plan que ponga aquí.
        </p>

        <form action={create} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted)]">¿A quién?</span>
            <select
              name="beneficiaryType"
              value={tipo}
              onChange={(event) => setTipo(event.target.value as Beneficiary['type'])}
              className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm"
            >
              <option value="WORKER">Un trabajador</option>
              <option value="CREW">Una cuadrilla</option>
              <option value="CONTRACTOR">Un contratista</option>
              <option value="RECIPIENT">Una empresa receptora</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
              Beneficiario<span className="text-red-600"> *</span>
            </span>
            <select
              name="beneficiaryId"
              required
              className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm"
            >
              <option value="">— escoge —</option>
              {delTipo.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {delTipo.length === 0 ? (
              <span className="mt-1 block text-xs text-amber-700">
                No hay ninguno de ese tipo cargado todavía.
              </span>
            ) : null}
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Monto" name="amount" required placeholder="300.00" />
            <Field label="Fecha" name="requestDate" type="date" required defaultValue={today} />
          </div>

          <Field
            label="Para qué es"
            name="reason"
            required
            placeholder="Capital inicial para arrancar"
          />

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
              Cómo se recupera
            </span>
            <select
              name="recoveryMethod"
              value={metodo}
              onChange={(event) => setMetodo(event.target.value)}
              className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm"
            >
              <option value="FIXED_WEEKLY">Monto fijo cada período</option>
              <option value="PERCENTAGE_OF_NET">Porcentaje del neto</option>
              <option value="PERCENTAGE_WITH_CAP">Porcentaje del neto, con tope</option>
              <option value="MANUAL">Manual — se decide cada vez</option>
              <option value="LUMP_SUM">Todo de una vez</option>
            </select>
          </label>

          {metodo === 'FIXED_WEEKLY' ? (
            <Field
              label="Cuánto por período"
              name="recoveryAmount"
              required
              placeholder="30.00"
              hint="Si el saldo es menor, se descuenta solo lo que falta."
            />
          ) : null}

          {metodo === 'PERCENTAGE_OF_NET' || metodo === 'PERCENTAGE_WITH_CAP' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="% del neto" name="recoveryPct" required placeholder="10" />
              {metodo === 'PERCENTAGE_WITH_CAP' ? (
                <Field label="Tope por período" name="recoveryCap" placeholder="200.00" />
              ) : null}
            </div>
          ) : null}

          {metodo === 'MANUAL' ? (
            <p className="rounded-md border border-[var(--border)] bg-[var(--hover)] p-2.5 text-xs text-[var(--muted)]">
              Con este método el sistema <strong>no propone</strong> ningún descuento: cada semana
              alguien decide cuánto. Se avisa del saldo al pagar.
            </p>
          ) : null}

          <Field label="Notas" name="notes" />

          <button
            type="submit"
            disabled={saving}
            className="brand-gradient h-9 w-full rounded-full text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
          >
            {saving ? 'Guardando…' : 'Crear préstamo'}
          </button>
          <p className="text-center text-xs text-[var(--muted)]">
            Queda esperando aprobación de otra persona.
          </p>
        </form>
      </div>
    </div>
  )
}

function Field({
  label,
  name,
  type = 'text',
  required,
  defaultValue,
  placeholder,
  hint,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  defaultValue?: string
  placeholder?: string
  hint?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--accent)]"
      />
      {hint ? <span className="mt-1 block text-xs text-[var(--muted)]">{hint}</span> : null}
    </label>
  )
}
