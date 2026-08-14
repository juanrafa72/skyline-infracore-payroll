'use client'

import { useActionState } from 'react'
import { createBillingRate, deactivateBillingRate } from './actions'

export interface Option {
  value: string
  label: string
}

export interface RateRow {
  id: string
  customer: string
  amount: string
  shiftLabel: string
  typeLabel: string
  scope: string
  from: string
  to: string | null
  current: boolean
  sourceNote: string | null
}

function currency(value: string): string {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Alta de una tarifa de venta y listado del historial.
 *
 * No hay botón de "editar": cambiar un precio es abrir uno nuevo desde la
 * fecha del cambio. Un campo editable invitaría a corregir el pasado, que es
 * justo lo que no puede pasar con lo que ya se facturó.
 */
export function RateForm({
  customers,
  projects,
  operations,
  crews,
  rows,
  today,
}: {
  customers: readonly Option[]
  projects: readonly Option[]
  operations: readonly Option[]
  crews: readonly Option[]
  rows: readonly RateRow[]
  today: string
}) {
  const [createResult, create, saving] = useActionState(createBillingRate, null)
  const [offResult, deactivate] = useActionState(deactivateBillingRate, null)

  const result = createResult ?? offResult
  const ok = result?.startsWith('LISTO|')

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

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center">
            <p className="font-medium">Todavía no hay tarifas de venta</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Sin ellas el sistema sabe cuánto le cuesta la gente, pero no cuánto le pagan por
              ella — así que no puede calcular margen.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.id}
                className={`rounded-lg border bg-[var(--surface)] p-3 ${
                  row.current ? 'border-[var(--border)]' : 'border-dashed border-[var(--border)] opacity-70'
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-[160px] flex-1">
                    <p className="text-sm font-semibold">
                      {row.customer}
                      {row.current ? null : (
                        <span className="ml-2 rounded border border-[var(--border)] px-1.5 py-0.5 text-xs font-normal text-[var(--muted)]">
                          histórica
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {row.typeLabel} · turno {row.shiftLabel} · {row.scope}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">${currency(row.amount)}</p>
                    <p className="text-xs text-[var(--muted)]">
                      desde {row.from}
                      {row.to ? ` hasta ${row.to}` : ' · vigente'}
                    </p>
                  </div>

                  {row.current ? (
                    <form action={deactivate}>
                      <input type="hidden" name="rateId" value={row.id} />
                      <button
                        type="submit"
                        className="rounded border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--hover)]"
                      >
                        apagar
                      </button>
                    </form>
                  ) : null}
                </div>

                {row.sourceNote ? (
                  <p className="mt-1.5 border-t border-[var(--border)] pt-1.5 text-xs text-[var(--muted)]">
                    {row.sourceNote}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold">Nueva tarifa de venta</h2>
        <p className="mb-3 mt-1 text-xs text-[var(--muted)]">
          Si ya hay una del mismo alcance, se cierra sola el día antes. Las semanas ya calculadas
          no cambian.
        </p>

        <form action={create} className="space-y-3">
          <Select label="Cliente que paga" name="customerId" options={customers} required />

          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Monto" name="amount" placeholder="600.00" required />
            <Select
              label="Turno"
              name="shift"
              options={[
                { value: 'DAY', label: 'Día' },
                { value: 'NIGHT', label: 'Noche' },
                { value: 'ANY', label: 'Cualquiera' },
              ]}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Se cobra por"
              name="rateType"
              options={[
                { value: 'DAILY', label: 'Día' },
                { value: 'HOURLY', label: 'Hora' },
                { value: 'WEEKLY', label: 'Semana' },
                { value: 'PIECE', label: 'Unidad' },
              ]}
            />
            <Input label="Aplica desde" name="effectiveFrom" type="date" defaultValue={today} required />
          </div>

          <p className="border-t border-[var(--border)] pt-3 text-xs font-medium text-[var(--muted)]">
            Opcional — deja en blanco si aplica a todo
          </p>
          <Select label="Solo este proyecto" name="projectId" options={projects} blank />
          <Select label="Solo esta operación" name="operationId" options={operations} blank />
          <Select label="Solo esta cuadrilla" name="crewId" options={crews} blank />

          <Input label="De dónde sale" name="sourceNote" placeholder="Contrato, orden de compra…" />

          <button
            type="submit"
            disabled={saving}
            className="h-9 w-full rounded-md bg-[var(--accent)] text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
          >
            {saving ? 'Guardando…' : 'Guardar tarifa'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Input({
  label,
  name,
  type = 'text',
  required,
  defaultValue,
  placeholder,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  defaultValue?: string
  placeholder?: string
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
    </label>
  )
}

function Select({
  label,
  name,
  options,
  required,
  blank,
}: {
  label: string
  name: string
  options: readonly Option[]
  required?: boolean
  blank?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      <select
        name={name}
        required={required}
        className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--accent)]"
      >
        {blank || !required ? <option value="">—</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
