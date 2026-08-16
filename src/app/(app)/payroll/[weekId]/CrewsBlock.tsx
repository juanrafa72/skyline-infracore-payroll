'use client'

import { useActionState } from 'react'
import { saveCrewControlDays } from '../actions'
import { ContractorBreakdown, type ContractorPanel } from './ContractorBreakdown'

export interface CrewProductionRow {
  id: string
  label: string
  quantity: string
  cost: string
  revenue: string | null
  margin: string | null
}

export interface CrewView {
  crewId: string
  crewName: string
  contractorName: string | null
  hasContractor: boolean
  payable: { total: string; count: number; statusLabel: string } | null
  members: ReadonlyArray<{ workerId: string; name: string }>
  controlDays: ReadonlyArray<string>
  production: ReadonlyArray<CrewProductionRow>
}

function currency(value: string | number): string {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Bloque de cuadrillas de la semana: producción → deuda con el contratista,
 * más los días de control de su gente.
 *
 * Aquí NADIE cobra por día: al contratista se le paga el total de producción y
 * él le paga a su gente. Los días de los integrantes se anotan solo como
 * control interno — por eso viven en una cuadrícula aparte de la de personal,
 * y guardarlos jamás toca un día pagado.
 */
export function CrewsBlock({
  weekId,
  shortDays,
  crews,
  loose,
  panels = [],
}: {
  weekId: string
  /** Días de la semana: [iso, etiqueta corta]. */
  shortDays: ReadonlyArray<{ iso: string; label: string }>
  crews: readonly CrewView[]
  /** Producción sin cuadrilla (histórica): visible para que no se pierda. */
  loose: readonly CrewProductionRow[]
  /** Desglose y conciliación por contratista, uno por liquidación calculada. */
  panels?: readonly ContractorPanel[]
}) {
  const [result, action, saving] = useActionState(saveCrewControlDays, null)
  const ok = result !== null && result.startsWith('LISTO|')

  const anyMembers = crews.some((crew) => crew.members.length > 0)

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] p-3.5">
        <h2 className="text-sm font-semibold">Cuadrillas — se paga al contratista</h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          La producción de la semana se vuelve una liquidación por cuadrilla al presionar
          «Calcular nómina». Los días de la gente son control interno: <strong>no generan pago
          individual</strong>.
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

        <ul className="divide-y divide-[var(--border)]">
          {crews.map((crew) => (
            <li key={crew.crewId} className="p-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{crew.crewName}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {crew.hasContractor ? (
                      <>se le paga a <strong>{crew.contractorName}</strong></>
                    ) : (
                      <span className="font-medium text-red-700">
                        sin contratista — no se podrá aprobar hasta asignárselo en Cuadrillas
                      </span>
                    )}
                  </p>
                </div>
                {crew.payable ? (
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">
                      ${currency(crew.payable.total)}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {crew.payable.count} registro(s) · {crew.payable.statusLabel}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--muted)]">
                    aún sin liquidar — presiona «Calcular nómina»
                  </p>
                )}
              </div>

              {crew.production.length > 0 ? (
                <ul className="mt-2 space-y-0.5">
                  {crew.production.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-[var(--muted)]"
                    >
                      <span className="min-w-[140px] flex-1">
                        {row.label} · {row.quantity}
                      </span>
                      <span className="tabular-nums">
                        {row.revenue === null ? 'sin venta' : `venta $${currency(row.revenue)}`}
                      </span>
                      <span className="tabular-nums">costo ${currency(row.cost)}</span>
                      <span
                        className={`min-w-[80px] text-right font-medium tabular-nums ${
                          row.margin !== null && Number(row.margin) < 0 ? 'text-red-700' : ''
                        }`}
                      >
                        {row.margin === null ? '—' : `$${currency(row.margin)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {crew.members.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="min-w-[150px] py-1 pr-2 text-left font-medium text-[var(--muted)]">
                          Su gente (control, sin pago)
                        </th>
                        {shortDays.map((day) => (
                          <th
                            key={day.iso}
                            className="px-1 py-1 text-center font-medium text-[var(--muted)]"
                          >
                            {day.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {crew.members.map((member) => (
                        <tr key={member.workerId} className="border-t border-[var(--border)]">
                          <td className="py-1 pr-2">
                            {member.name}
                            <input
                              type="hidden"
                              name={`controlmember:${member.workerId}`}
                              value={crew.crewId}
                            />
                          </td>
                          {shortDays.map((day) => (
                            <td key={day.iso} className="px-1 py-1 text-center">
                              <input
                                type="checkbox"
                                name={`controlday:${member.workerId}:${day.iso}`}
                                defaultChecked={crew.controlDays.includes(
                                  `${member.workerId}:${day.iso}`,
                                )}
                                className="h-3.5 w-3.5"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Esta cuadrilla no tiene integrantes registrados (se agregan en Cuadrillas).
                </p>
              )}
            </li>
          ))}
        </ul>

        {anyMembers ? (
          <div className="border-t border-[var(--border)] px-3.5 py-3">
            <button
              type="submit"
              disabled={saving}
              className="h-9 rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
            >
              {saving ? 'Guardando…' : 'Guardar días de control'}
            </button>
            <span className="ml-3 text-xs text-[var(--muted)]">
              Solo control: no cambian ningún pago ni tumban aprobaciones.
            </span>
          </div>
        ) : null}
      </form>

      {/*
        Contratistas: qué construyó cada uno, cómo se reparte entre su gente y
        si eso cuadra con lo que dice SharePoint.

        Va FUERA del formulario de días de control: son dos guardados distintos
        y un <form> dentro de otro es HTML inválido — el navegador descarta el
        de adentro y su botón termina enviando el de afuera.
      */}
      {panels.map((panel) => (
        <ContractorBreakdown key={panel.crewPayrollId} panel={panel} />
      ))}

      {loose.length > 0 ? (
        <div className="border-t border-[var(--border)] px-3.5 py-2.5">
          <p className="mb-1 text-xs font-semibold text-[var(--muted)]">
            Producción sin cuadrilla (histórica)
          </p>
          <ul className="space-y-0.5">
            {loose.map((row) => (
              <li key={row.id} className="flex flex-wrap gap-x-4 text-xs text-[var(--muted)]">
                <span className="min-w-[140px] flex-1">
                  {row.label} · {row.quantity}
                </span>
                <span className="tabular-nums">costo ${currency(row.cost)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
