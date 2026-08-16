'use client'

import { useActionState, useState } from 'react'
import { setCrewBilling } from '../actions'

/**
 * Cómo cobra la cuadrilla y a quién se le paga.
 *
 * Dos datos que se deciden juntos: si cobra por pie construido o un precio
 * fijo por día, y quién es el contratista que recibe el dinero (BR-242).
 *
 * El negocio lo pidió porque pasaba de verdad y no se podía registrar: había
 * que inventarle una producción falsa a una cuadrilla que cobraba por día para
 * que el sistema la liquidara.
 */
export function BillingForm({
  crewId,
  billingMode,
  dailyRate,
  contractorId,
  contractors,
  canManage,
}: {
  crewId: string
  billingMode: 'PRODUCTION' | 'DAILY'
  dailyRate: string | null
  contractorId: string | null
  contractors: ReadonlyArray<{ id: string; name: string }>
  canManage: boolean
}) {
  const [result, action, saving] = useActionState(setCrewBilling, null)
  const [modo, setModo] = useState(billingMode)
  const ok = result?.startsWith('LISTO|')

  return (
    <form action={action} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold">Cómo cobra y a quién se le paga</h2>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        Al contratista se le paga el total de la semana y él le paga a su gente. El desglose
        interno se lleva al montar la nómina.
      </p>

      {result ? (
        <p
          className={`mt-3 rounded-md border p-2.5 text-sm ${
            ok
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {result.replace(/^LISTO\|/, '')}
        </p>
      ) : null}

      <input type="hidden" name="crewId" value={crewId} />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Cómo cobra</span>
          <select
            name="billingMode"
            value={modo}
            onChange={(e) => setModo(e.target.value as 'PRODUCTION' | 'DAILY')}
            disabled={!canManage}
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
          >
            <option value="PRODUCTION">Por producción (pies construidos)</option>
            <option value="DAILY">Precio fijo por día</option>
          </select>
        </label>

        {/* La tarifa solo tiene sentido si cobra por día. */}
        {modo === 'DAILY' ? (
          <label className="text-sm">
            <span className="mb-1 block text-[var(--muted)]">Cuánto por día</span>
            <input
              name="dailyRate"
              defaultValue={dailyRate ?? ''}
              inputMode="decimal"
              placeholder="800.00"
              disabled={!canManage}
              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-right text-sm tabular-nums"
            />
            <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
              Sin esto no se puede calcular lo que se le debe.
            </span>
          </label>
        ) : (
          <p className="self-end text-xs text-[var(--muted)]">
            Los precios por unidad se configuran abajo, en «Precios por unidad».
          </p>
        )}

        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-[var(--muted)]">A quién se le paga</span>
          <select
            name="contractorId"
            defaultValue={contractorId ?? ''}
            disabled={!canManage}
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
          >
            <option value="">— sin contratista —</option>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
            Sin contratista la liquidación no se puede aprobar: no hay a quién pagarle.
          </span>
        </label>
      </div>

      {canManage ? (
        <button
          type="submit"
          disabled={saving}
          className="brand-gradient mt-4 inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-45"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      ) : null}
    </form>
  )
}
