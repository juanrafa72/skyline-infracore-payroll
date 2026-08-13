'use client'

import { useActionState, useState } from 'react'
import { payPayroll, returnToApproval } from './actions'

export interface PaymentRow {
  id: string
  workerName: string
  weekLabel: string
  period: string
  days: number
  halfDays: number
  gross: string
  deductions: string
  net: string
  approvedByMe: boolean
  bankLast4: string | null
}

function currency(value: string): string {
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function PaymentPanel({
  rows,
  canPay,
}: {
  rows: readonly PaymentRow[]
  canPay: boolean
}) {
  const [paying, setPaying] = useState<string | null>(null)
  const [payResult, payAction] = useActionState(payPayroll, null)
  const [returnResult, returnAction] = useActionState(returnToApproval, null)

  const result = payResult ?? returnResult
  const ok = result?.startsWith('LISTO|')
  const today = new Date().toISOString().slice(0, 10)

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
          {result.replace(/^LISTO\|/, '')}
        </p>
      ) : null}

      <div className="space-y-2">
        {rows.map((row) => {
          const isOpen = paying === row.id
          const blocked = row.approvedByMe

          return (
            <div
              key={row.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"
            >
              <div className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-[170px] flex-1">
                  <p className="text-sm font-semibold">{row.workerName}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {row.weekLabel} · {row.days} días
                    {row.halfDays > 0 ? ` + ${row.halfDays} medio(s)` : ''}
                    {row.bankLast4 ? ` · cuenta ****${row.bankLast4}` : ''}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">${currency(row.net)}</p>
                  <p className="text-xs text-[var(--muted)] tabular-nums">
                    bruto ${currency(row.gross)} − ${currency(row.deductions)}
                  </p>
                </div>

                {canPay && !blocked ? (
                  <button
                    type="button"
                    onClick={() => setPaying(isOpen ? null : row.id)}
                    className="h-9 rounded-md bg-[var(--accent)] px-3.5 text-sm font-medium text-white hover:opacity-90"
                  >
                    {isOpen ? 'Cancelar' : 'Registrar pago'}
                  </button>
                ) : (
                  <span className="text-xs text-[var(--muted)]">
                    {blocked ? 'la aprobaste tú' : 'sin permiso de pago'}
                  </span>
                )}
              </div>

              {blocked ? (
                <p className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
                  Tú aprobaste esta nómina. El pago debe registrarlo otra persona.
                </p>
              ) : null}

              {isOpen ? (
                <form action={payAction} className="border-t border-[var(--border)] p-3">
                  <input type="hidden" name="payrollId" value={row.id} />
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Fecha de pago" name="paymentDate" type="date" defaultValue={today} />
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
                        Método
                      </span>
                      <select
                        name="method"
                        className="h-9 w-full rounded-md border border-[var(--border)] px-2 text-sm"
                      >
                        <option value="ZELLE">Zelle</option>
                        <option value="ACH">ACH</option>
                        <option value="WIRE">Transferencia</option>
                        <option value="CHECK">Cheque</option>
                        <option value="CASH">Efectivo</option>
                        <option value="OTHER">Otro</option>
                      </select>
                    </label>
                    <Field
                      label="Monto pagado"
                      name="amountPaid"
                      defaultValue={row.net}
                      hint={`aprobado: $${currency(row.net)}`}
                    />
                    <Field label="Referencia" name="reference" placeholder="ZL-88213" />
                    <div className="sm:col-span-2 lg:col-span-4">
                      <Field label="Notas" name="notes" />
                    </div>
                  </div>

                  <p className="mt-2 text-xs text-[var(--muted)]">
                    Falta cargar el comprobante bancario: irá a SharePoint cuando la conexión esté
                    lista. Por ahora el pago queda registrado con su referencia.
                  </p>

                  <button
                    type="submit"
                    className="mt-3 h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90"
                  >
                    Confirmar pago
                  </button>
                </form>
              ) : null}
            </div>
          )
        })}
      </div>

      <form action={returnAction} className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="text-sm font-semibold">¿Encontraste un error?</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Devuelve la nómina a aprobación con el motivo. No la corrijas desde aquí.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <select
            name="payrollId"
            className="h-9 min-w-[200px] flex-1 rounded-md border border-[var(--border)] px-2 text-sm"
          >
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.workerName} · ${currency(row.net)}
              </option>
            ))}
          </select>
          <input
            name="reason"
            required
            placeholder="Motivo (obligatorio)"
            className="h-9 min-w-[220px] flex-1 rounded-md border border-[var(--border)] px-2.5 text-sm"
          />
          <button
            type="submit"
            className="h-9 rounded-md border border-[var(--border)] px-3.5 text-sm font-medium hover:bg-[var(--hover)]"
          >
            Devolver
          </button>
        </div>
      </form>
    </>
  )
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  placeholder,
  hint,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  placeholder?: string
  hint?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required
        className="h-9 w-full rounded-md border border-[var(--border)] px-2.5 text-sm"
      />
      {hint ? <span className="mt-1 block text-xs text-[var(--muted)]">{hint}</span> : null}
    </label>
  )
}
