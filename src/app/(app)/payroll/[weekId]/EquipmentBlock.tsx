'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { saveEquipmentWeekDays } from '../actions'

export interface EquipmentRow {
  equipmentId: string
  name: string
  kindLabel: string
  dailyCost: string | null
  vendorName: string | null
  hasVendor: boolean
  payable: { total: string; days: number; statusLabel: string } | null
  markedDays: ReadonlyArray<string>
}

function currency(value: string): string {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Equipo rentado de la semana: un camión se alquila por día completo o no se
 * alquila. Marcar días arma la liquidación que se le paga al PROVEEDOR del
 * equipo — jamás al equipo (BR-121). El aprobador escoge la empresa receptora
 * al aprobar, igual que con las personas.
 */
export function EquipmentBlock({
  weekId,
  shortDays,
  rows,
}: {
  weekId: string
  shortDays: ReadonlyArray<{ iso: string; label: string }>
  rows: readonly EquipmentRow[]
}) {
  const [result, action, saving] = useActionState(saveEquipmentWeekDays, null)
  const ok = result !== null && result.startsWith('LISTO|')

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] p-3.5">
        <h2 className="text-sm font-semibold">Equipo rentado — se paga al proveedor</h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Día marcado = día de alquiler. Al presionar «Calcular nómina» los días se vuelven la
          liquidación del proveedor (días × costo diario congelado).{' '}
          <Link prefetch={false} href="/equipment" className="text-[var(--accent)] underline">
            Administrar equipos
          </Link>
        </p>
      </div>

      {result ? (
        <p
          className={`mx-3.5 mt-3 rounded-md border p-2.5 text-sm ${
            ok
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {result.replace(/^LISTO\|/, '')}
        </p>
      ) : null}

      <form action={action}>
        <input type="hidden" name="weekId" value={weekId} />

        <div className="overflow-x-auto p-3.5">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="min-w-[180px] py-1 pr-2 text-left font-medium text-[var(--muted)]">
                  Equipo
                </th>
                {shortDays.map((day) => (
                  <th key={day.iso} className="px-1 py-1 text-center font-medium text-[var(--muted)]">
                    {day.label}
                  </th>
                ))}
                <th className="min-w-[130px] py-1 pl-2 text-right font-medium text-[var(--muted)]">
                  Liquidación
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.equipmentId} className="border-t border-[var(--border)]">
                  <td className="py-1.5 pr-2">
                    <p className="text-sm font-medium">{row.name}</p>
                    <p className="text-[11px] text-[var(--muted)]">
                      {row.kindLabel} ·{' '}
                      {row.dailyCost ? (
                        `$${currency(row.dailyCost)}/día`
                      ) : (
                        <span className="font-medium text-red-700">sin costo diario</span>
                      )}{' '}
                      ·{' '}
                      {row.hasVendor ? (
                        <>cobra {row.vendorName}</>
                      ) : (
                        <span className="font-medium text-red-700">sin proveedor</span>
                      )}
                    </p>
                    <input type="hidden" name={`equipomember:${row.equipmentId}`} value="1" />
                  </td>
                  {shortDays.map((day) => (
                    <td key={day.iso} className="px-1 py-1.5 text-center">
                      <input
                        type="checkbox"
                        name={`equipoday:${row.equipmentId}:${day.iso}`}
                        defaultChecked={row.markedDays.includes(`${row.equipmentId}:${day.iso}`)}
                        className="h-3.5 w-3.5"
                      />
                    </td>
                  ))}
                  <td className="py-1.5 pl-2 text-right">
                    {row.payable ? (
                      <>
                        <p className="text-sm font-semibold tabular-nums">
                          ${currency(row.payable.total)}
                        </p>
                        <p className="text-[11px] text-[var(--muted)]">
                          {row.payable.days} día(s) · {row.payable.statusLabel}
                        </p>
                      </>
                    ) : (
                      <span className="text-[11px] text-[var(--muted)]">sin liquidar</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-[var(--border)] px-3.5 py-3">
          <button
            type="submit"
            disabled={saving}
            className="h-9 rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
          >
            {saving ? 'Guardando…' : 'Guardar días de equipo'}
          </button>
          <span className="ml-3 text-xs text-[var(--muted)]">
            Si la liquidación ya estaba aprobada, se cae y vuelve a aprobación — con rastro.
          </span>
        </div>
      </form>
    </section>
  )
}
