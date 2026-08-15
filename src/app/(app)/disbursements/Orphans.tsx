'use client'

import { useActionState } from 'react'
import { generateMissingOrdersAction } from './actions'

export interface OrphanRow {
  id: string
  name: string
  weekLabel: string
  recipientName: string | null
  amount: string
}

/**
 * Lo aprobado que se quedó sin orden.
 *
 * Es plata aprobada que nadie ve en esta pantalla. Antes solo se avisaba y se
 * mandaba a otra parte; ahora se agrupa desde aquí, que es lo que uno quiere
 * hacer cuando lo ve. Agrupar lo hace quien aprueba: tesorería no decide a qué
 * empresa receptora va nada.
 */
export function Orphans({
  rows,
  total,
  canGenerate,
}: {
  rows: readonly OrphanRow[]
  total: string
  canGenerate: boolean
}) {
  const [result, generate, working] = useActionState(generateMissingOrdersAction, null)
  const ok = result?.startsWith('LISTO|')

  return (
    <section className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">
        {rows.length} liquidación(es) aprobada(s) sin orden · ${total}
      </p>
      <p className="mt-1">
        Están aprobadas pero no entraron en ninguna orden, así que nadie las ve para pagarlas.
      </p>

      <ul className="mt-2 space-y-0.5 text-xs">
        {rows.slice(0, 12).map((row) => (
          <li key={row.id} className="flex flex-wrap justify-between gap-2">
            <span>
              {row.name} · {row.weekLabel} · {row.recipientName ?? 'sin empresa receptora'}
            </span>
            <span className="tabular-nums">${Number(row.amount).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}</span>
          </li>
        ))}
      </ul>
      {rows.length > 12 ? <p className="mt-1 text-xs">y {rows.length - 12} más.</p> : null}

      {result ? (
        <p
          className={`mt-2 rounded-md border p-2.5 text-sm ${
            ok
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {result.replace(/^(LISTO|PARCIAL)\|/, '')}
        </p>
      ) : null}

      {canGenerate ? (
        <form action={generate} className="mt-3">
          <button
            type="submit"
            disabled={working}
            className="h-9 rounded-md bg-amber-700 px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
          >
            {working ? 'Agrupando…' : 'Generar las órdenes que faltan'}
          </button>
          <span className="ml-2 text-xs">
            Las que no tengan empresa receptora no se pueden agrupar: eso se asigna en Aprobar.
          </span>
        </form>
      ) : (
        <p className="mt-2 text-xs">
          Pídele a quien aprueba que las agrupe: el botón está en esta misma pantalla, con su
          usuario.
        </p>
      )}
    </section>
  )
}
