'use client'

import { useMemo, useState } from 'react'
import { useActionState } from 'react'
import {
  RECONCILE_LABEL,
  RECONCILE_TONE,
  UNIDAD_TARIFA,
  calculateContractorWeek,
  describeDifference,
} from '@/lib/payroll/contractors'
import { toDecimalString } from '@/lib/payroll/engine/money'
import { saveContractorBreakdown } from '../actions'

export interface BreakdownMember {
  id: string
  workerId: string | null
  name: string
  rateAmount: string
  rateUnit: string
  quantity: string
  amount: string
  isContractor: boolean
}

export interface BreakdownProduction {
  id: string
  quantity: string
  price: string
  amount: string
  unitLabel: string
  projectName: string | null
  date: string
}

export interface ContractorPanel {
  crewPayrollId: string
  crewName: string
  contractorName: string | null
  editable: boolean
  members: readonly BreakdownMember[]
  production: readonly BreakdownProduction[]
  expectedTotal: string | null
  /**
   * Desglose propuesto. Trae tarifas cuando viene de la semana anterior; sin
   * ellas cuando solo sale del catálogo de la cuadrilla.
   */
  suggestion: ReadonlyArray<{
    workerId: string | null
    name: string
    isContractor: boolean
    rateAmount?: string
    quantity?: string
    rateUnit?: string
  }>
  /** Si la propuesta viene de la semana pasada, se dice de dónde salió. */
  suggestionFromLastWeek: boolean
}

/** Una fila de la tabla mientras se edita, antes de guardarse. */
interface Row {
  key: string
  workerId: string | null
  name: string
  rateAmount: string
  quantity: string
  rateUnit: string
  isContractor: boolean
}

function money(value: string | number): string {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Un precio por unidad: mínimo 2 decimales, hasta 4 si los usa.
 * `$0.5` se lee mal cuando la cifra es una tarifa; `$0.50` y `$0.3025` no.
 */
function precio(value: string | number): string {
  const n = Number(value)
  const cuatro = n.toFixed(4)
  return cuatro.endsWith('00') ? n.toFixed(2) : cuatro
}

let contador = 0
const nuevaClave = () => `nueva-${(contador += 1)}`

/**
 * El contratista de la semana: qué construyó, cuánto se le paga, cómo se
 * reparte entre su gente, y si eso cuadra con lo que dice SharePoint.
 *
 * La cuenta se rehace EN EL NAVEGADOR mientras se escribe, con la misma
 * función pura que usa el servidor al guardar (`calculateContractorWeek`). Si
 * cada lado hiciera su propia cuenta, la pantalla podría mostrar que cuadra y
 * la base guardar otra cosa.
 */
export function ContractorBreakdown({ panel }: { panel: ContractorPanel }) {
  const [result, action, saving] = useActionState(saveContractorBreakdown, null)

  const [rows, setRows] = useState<Row[]>(() =>
    panel.members.map((member) => ({
      key: member.id,
      workerId: member.workerId,
      name: member.name,
      rateAmount: member.rateAmount,
      quantity: member.quantity,
      rateUnit: member.rateUnit,
      isContractor: member.isContractor,
    })),
  )
  const [expected, setExpected] = useState(panel.expectedTotal ?? '')

  // La cuenta en vivo: lo que se ve mientras se teclea.
  const cuenta = useMemo(() => {
    try {
      return calculateContractorWeek({
        production: panel.production.map((row) => ({
          quantity: row.quantity,
          price: row.price,
        })),
        members: rows
          .filter((row) => row.name.trim() !== '')
          .map((row) => ({
            name: row.name,
            rateAmount: row.rateAmount || '0',
            quantity: row.quantity || '0',
            isContractor: row.isContractor,
          })),
        expectedTotal: expected || null,
      })
    } catch {
      // Mientras se escribe «0.3» o «1.» los valores pasan por estados que no
      // son números todavía. No es un error: es alguien tecleando.
      return null
    }
  }, [panel.production, rows, expected])

  const actualizar = (key: string, campo: keyof Row, valor: string | boolean) =>
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, [campo]: valor } : row)))

  const agregar = () =>
    setRows((prev) => [
      ...prev,
      {
        key: nuevaClave(),
        workerId: null,
        name: '',
        rateAmount: '',
        quantity: '1',
        rateUnit: 'WEEK',
        isContractor: false,
      },
    ])

  const traerGente = () =>
    setRows(
      panel.suggestion.map((s) => ({
        key: nuevaClave(),
        workerId: s.workerId,
        name: s.name,
        rateAmount: s.rateAmount ?? '',
        quantity: s.quantity ?? '1',
        rateUnit: s.rateUnit ?? 'WEEK',
        isContractor: s.isContractor,
      })),
    )

  const ok = result !== null && result.startsWith('LISTO|')
  const tono = cuenta ? RECONCILE_TONE[cuenta.status] : 'info'

  return (
    <div className="border-t border-[var(--border)] p-3.5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {panel.contractorName ?? panel.crewName}
          <span className="ml-2 font-normal text-[var(--muted)]">
            — lo que construyó y cómo se reparte
          </span>
        </h3>
      </div>

      {/* Lo que construyó: de aquí sale lo que se le paga. */}
      {panel.production.length > 0 ? (
        <div className="mb-4 overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-[var(--hover)]">
              <tr>
                {['Fecha', 'Proyecto', 'Cantidad', 'Tarifa', 'Se le paga'].map((h, i) => (
                  <th
                    key={h}
                    className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] ${
                      i > 1 ? 'text-right' : 'text-left'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {panel.production.map((row) => (
                <tr key={row.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2">{row.date}</td>
                  <td className="px-3 py-2">{row.projectName ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(row.quantity).toLocaleString('en-US')} {row.unitLabel}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">${precio(row.price)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    ${money(row.amount)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--border)] bg-[var(--hover)] font-semibold">
                <td className="px-3 py-2" colSpan={4}>
                  Total de producción
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  ${cuenta ? money(toDecimalString(cuenta.productionTotal)) : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-sm text-[var(--muted)]">
          Todavía no hay producción registrada para esta cuadrilla esta semana. Se captura en{' '}
          <strong>Producción</strong>: cantidad construida y tarifa por unidad.
        </p>
      )}

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

      <form action={action}>
        <input type="hidden" name="crewPayrollId" value={panel.crewPayrollId} />
        <input type="hidden" name="filas" value={JSON.stringify(rows)} />
        <input type="hidden" name="expectedTotal" value={expected} />

        {/* La gente del contratista, con su tarifa. Todo editable aquí mismo. */}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-medium">Su gente y las tarifas que él pactó</h4>
          {panel.editable ? (
            <div className="flex flex-wrap gap-2">
              {panel.suggestion.length > 0 ? (
                <button
                  type="button"
                  onClick={traerGente}
                  className="rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--hover)]"
                  title={
                    panel.suggestionFromLastWeek
                      ? 'Trae la misma gente y las mismas tarifas de la semana pasada'
                      : 'Trae la gente de la cuadrilla; las tarifas las escribes tú'
                  }
                >
                  {panel.suggestionFromLastWeek
                    ? `Copiar la semana pasada (${panel.suggestion.length})`
                    : `Traer la gente de la cuadrilla (${panel.suggestion.length})`}
                </button>
              ) : null}
              <button
                type="button"
                onClick={agregar}
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--hover)]"
              >
                + Agregar persona
              </button>
            </div>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <p className="mb-3 rounded-lg border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted)]">
            Sin desglose todavía. Agrega a la gente del contratista con su tarifa para poder
            conciliar contra lo que dice SharePoint.
          </p>
        ) : (
          <div className="mb-3 overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-[var(--hover)]">
                <tr>
                  {['Persona', 'Tarifa', 'Por', 'Cantidad', 'Le toca', ''].map((h, i) => (
                    <th
                      key={h || 'quitar'}
                      className={`px-2 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] ${
                        i >= 1 && i <= 4 ? 'text-right' : 'text-left'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  let subtotal = '0.00'
                  try {
                    subtotal = toDecimalString(
                      calculateContractorWeek({
                        production: [],
                        members: [
                          {
                            name: row.name || 'x',
                            rateAmount: row.rateAmount || '0',
                            quantity: row.quantity || '0',
                          },
                        ],
                      }).membersTotal,
                    )
                  } catch {
                    subtotal = '—'
                  }
                  return (
                    <tr
                      key={row.key}
                      className={`border-t border-[var(--border)] ${
                        row.isContractor ? 'bg-[var(--hover)]' : ''
                      }`}
                    >
                      <td className="px-2 py-1.5">
                        <input
                          value={row.name}
                          onChange={(e) => actualizar(row.key, 'name', e.target.value)}
                          disabled={!panel.editable}
                          placeholder="Nombre"
                          className="h-8 w-full min-w-36 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
                        />
                        {row.isContractor ? (
                          <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
                            el contratista — su parte también suma
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={row.rateAmount}
                          onChange={(e) => actualizar(row.key, 'rateAmount', e.target.value)}
                          disabled={!panel.editable}
                          inputMode="decimal"
                          placeholder="0.00"
                          className="h-8 w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-right text-sm tabular-nums"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={row.rateUnit}
                          onChange={(e) => actualizar(row.key, 'rateUnit', e.target.value)}
                          disabled={!panel.editable}
                          className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-sm"
                        >
                          {Object.entries(UNIDAD_TARIFA).map(([code, label]) => (
                            <option key={code} value={code}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={row.quantity}
                          onChange={(e) => actualizar(row.key, 'quantity', e.target.value)}
                          disabled={!panel.editable}
                          inputMode="decimal"
                          className="h-8 w-20 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-right text-sm tabular-nums"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                        ${subtotal === '—' ? '—' : money(subtotal)}
                      </td>
                      <td className="px-2 py-1.5">
                        {panel.editable ? (
                          <button
                            type="button"
                            onClick={() =>
                              setRows((prev) => prev.filter((r) => r.key !== row.key))
                            }
                            className="rounded px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                          >
                            quitar
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* La conciliación: lo que dice la fuente contra lo que sale de aquí. */}
        <div
          className={`rounded-lg border p-3.5 ${
            tono === 'good'
              ? 'border-emerald-300 bg-emerald-50'
              : tono === 'warning'
                ? 'border-amber-300 bg-amber-50'
                : 'border-[var(--border)] bg-[var(--bg)]'
          }`}
        >
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-[var(--muted)]">
                ¿Cuánto dice SharePoint que se le paga?
              </span>
              <input
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                disabled={!panel.editable}
                inputMode="decimal"
                placeholder="5000.00"
                className="h-9 w-36 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-right text-sm tabular-nums"
              />
            </label>

            <div className="text-sm">
              <span className="block text-[var(--muted)]">El desglose suma</span>
              <span className="text-lg font-semibold tabular-nums">
                ${cuenta ? money(toDecimalString(cuenta.breakdownTotal)) : '—'}
              </span>
            </div>

            {cuenta && cuenta.difference !== null ? (
              <div className="text-sm">
                <span className="block text-[var(--muted)]">Diferencia</span>
                <span className="text-lg font-semibold tabular-nums">
                  {describeDifference(cuenta.difference)}
                </span>
              </div>
            ) : null}

            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                tono === 'good'
                  ? 'bg-emerald-600 text-white'
                  : tono === 'warning'
                    ? 'bg-amber-600 text-white'
                    : 'bg-[var(--hover)] text-[var(--muted)]'
              }`}
            >
              {cuenta ? RECONCILE_LABEL[cuenta.status] : 'escribiendo…'}
            </span>
          </div>

          {cuenta ? (
            <p className="mt-2 text-sm">{cuenta.message}</p>
          ) : (
            <p className="mt-2 text-sm text-[var(--muted)]">
              Revisa las cifras: alguna no es un número válido todavía.
            </p>
          )}

          {panel.editable ? (
            <button
              type="submit"
              disabled={saving}
              className="brand-gradient mt-3 inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-45"
            >
              {saving ? 'Guardando…' : 'Guardar desglose y conciliación'}
            </button>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">
              Esta liquidación ya salió a aprobación: su desglose no se cambia aquí.
            </p>
          )}
        </div>
      </form>
    </div>
  )
}
